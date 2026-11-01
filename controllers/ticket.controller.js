const Ticket = require('../models/Ticket');
const logActivity = require('../utils/logActivity');
const removeUploadedFiles = require('../utils/removeUploadedFiles');
const { parsePagination, buildPaginationInfo } = require('../utils/pagination');
const { buildTicketQuery, sortStages } = require('../utils/ticketFilters');
const {
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  SUPPORT_ONLY_PRIORITY,
  isValidId,
  isNonEmptyString,
  checkTextLimits,
} = require('../utils/validation');
const fs = require('fs');
const path = require('path');

const UPLOAD_BASE = require('../middleware/upload').uploadDir;

// ---------- helpers ----------

// Only tickets that are not soft-deleted (also matches old docs without the field)
const findActiveTicket = (id) => Ticket.findOne({ _id: id, deleted: { $ne: true } });

// admin / superadmin: every ticket. user: only their own tickets.
const canAccessTicket = (user, ticket) =>
  user.role !== 'user' || ticket.createdBy.equals(user.userId);

// Which user fields are shown in tickets (creator, handler, reply senders).
// Normal users only see usernames — admins' emails stay private.
// Admins / superadmins also see emails (to contact users).
const ticketPopulate = (user) => {
  const select = user.role === 'user' ? 'username' : 'username email';
  return [
    { path: 'createdBy', select },
    { path: 'handledBy', select },
    { path: 'messages.sender', select },
  ];
};

// Safe absolute path of an attachment on disk.
// Uses the stored file NAME only (never a path from the database), so:
// - no "../" tricks can escape the uploads folder
// - paths saved on Windows ("uploads\tickets\x.pdf") still work on a Linux server
const storedFilePath = (attachment) => {
  const name = attachment.filename || String(attachment.path || '').split(/[\\/]/).pop();
  const safePath = path.join(UPLOAD_BASE, path.basename(name || ''));
  return safePath.startsWith(UPLOAD_BASE + path.sep) ? safePath : null;
};

// Every attachment of a ticket: the ticket's own files + the files of all replies
const allAttachments = (ticket) => [
  ...ticket.attachments,
  ...ticket.messages.flatMap((m) => m.attachments || []),
];

// Turn multer files into attachment sub-documents
const toAttachments = (files, extra = {}) =>
  (files || []).map((file) => ({
    filename: file.filename,
    originalName: file.originalname,
    // relative path ("uploads/tickets/x.pdf"): never expose the server's full folder path
    path: path.relative(process.cwd(), file.path),
    mimetype: file.mimetype,
    size: file.size,
    ...extra,
  }));

// Only the support team (admin / superadmin) can set the "urgent" priority.
// A user may keep it or lower it, but never raise a ticket to urgent.
const URGENT_FORBIDDEN = 'Only the support team can set the urgent priority';
const canSetPriority = (user, newPriority, currentPriority) =>
  user.role !== 'user' || newPriority !== SUPPORT_ONLY_PRIORITY || currentPriority === SUPPORT_ONLY_PRIORITY;

// ---------- controllers ----------

// Create a new ticket with file attachments
exports.createTicket = async (req, res) => {
  const { subject, description, category, priority } = req.body || {};

  if (![subject, description, category].every(isNonEmptyString)) {
    removeUploadedFiles(req.files);
    return res.status(400).json({ error: 'subject, description and category are required' });
  }
  const tooLong = checkTextLimits({ subject, description, category });
  if (tooLong) {
    removeUploadedFiles(req.files);
    return res.status(400).json({ error: tooLong });
  }
  if (priority !== undefined && priority !== '' && !TICKET_PRIORITIES.includes(priority)) {
    removeUploadedFiles(req.files);
    return res.status(400).json({ error: `Invalid priority. Allowed: ${TICKET_PRIORITIES.join(', ')}` });
  }
  if (!canSetPriority(req.user, priority, null)) {
    removeUploadedFiles(req.files);
    return res.status(403).json({ error: URGENT_FORBIDDEN });
  }

  try {
    const attachments = toAttachments(req.files, { uploadedBy: req.user.userId });

    const newTicket = new Ticket({
      subject,
      description,
      category,
      priority: priority || 'normal',
      createdBy: req.user.userId,
      attachments
    });

    await newTicket.save();

    await logActivity({
      user: req.user.userId,
      action: `Created a ticket: ${newTicket.subject} with ${attachments.length} attachment(s)`,
      target: newTicket._id,
      targetModel: 'Ticket'
    });

    return res.status(201).json({
      message: 'Ticket created successfully',
      ticketId: newTicket._id,
      attachmentsCount: attachments.length
    });
  } catch (err) {
    console.error(err);
    removeUploadedFiles(req.files);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Shared by GET /tickets and GET /tickets/my:
// filters + sort + pagination in ONE database query ($facet returns
// the page of tickets and the total count together).
const listTickets = async (req, res, { onlyMine, defaultSort }) => {
  const pagination = parsePagination(req.query);
  if (pagination.error) return res.status(400).json({ error: pagination.error });

  const built = buildTicketQuery(req.query, { user: req.user, onlyMine, defaultSort });
  if (built.error) return res.status(400).json({ error: built.error });

  try {
    const [result] = await Ticket.aggregate([
      { $match: built.match },
      ...sortStages(built.sort),
      {
        $facet: {
          tickets: [{ $skip: pagination.skip }, { $limit: pagination.limit }],
          total: [{ $count: 'count' }],
        },
      },
    ]);

    // aggregate() returns plain objects -> turn them back into Mongoose
    // documents so populate + virtuals (id, priorityWeight) work like before
    const tickets = result.tickets.map((doc) => Ticket.hydrate(doc));
    await Ticket.populate(tickets, ticketPopulate(req.user));

    const total = result.total.length ? result.total[0].count : 0;

    return res.status(200).json({
      tickets,
      pagination: buildPaginationInfo({ page: pagination.page, limit: pagination.limit, total }),
      sort: built.sort,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Get all tickets (admin and superadmin) — newest first by default
// GET /api/tickets?page=1&limit=20&status=en cours&priority=urgent&search=login&handledBy=none
exports.getAllTickets = (req, res) =>
  listTickets(req, res, { onlyMine: false, defaultSort: 'newest' });

// Get one ticket (owner, admin or superadmin)
exports.getTicketById = async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid ticket id' });

  try {
    const ticket = await findActiveTicket(id).populate(ticketPopulate(req.user));

    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    // createdBy is populated here, so compare its _id
    const ownerId = ticket.createdBy && ticket.createdBy._id ? ticket.createdBy._id : ticket.createdBy;
    if (req.user.role === 'user' && !ownerId.equals(req.user.userId)) {
      return res.status(403).json({ error: 'Access denied: You can only view your own tickets' });
    }

    return res.status(200).json(ticket);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Assign the current admin as handler of the ticket
exports.assignHandler = async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid ticket id' });

  try {
    const ticket = await findActiveTicket(id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    ticket.handledBy = req.user.userId; // the admin handling it
    // only move a new ticket to "en cours" — don't silently reopen a resolved one
    if (ticket.status === 'non résolu') {
      ticket.status = 'en cours';
    }
    await ticket.save();
    await logActivity({
      user: req.user.userId,
      action: 'Assigned self to ticket',
      target: ticket._id,
      targetModel: 'Ticket'
    });

    return res.status(200).json({ message: 'Ticket assigned and updated', status: ticket.status });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Reply to a ticket (with optional files)
exports.replyToTicket = async (req, res) => {
  const { id } = req.params;
  const { message } = req.body || {};
  const hasFiles = Array.isArray(req.files) && req.files.length > 0;

  if (!isValidId(id)) {
    removeUploadedFiles(req.files);
    return res.status(400).json({ error: 'Invalid ticket id' });
  }
  if (!isNonEmptyString(message) && !hasFiles) {
    removeUploadedFiles(req.files);
    return res.status(400).json({ error: 'A message or at least one attachment is required' });
  }
  const tooLong = checkTextLimits({ message });
  if (tooLong) {
    removeUploadedFiles(req.files);
    return res.status(400).json({ error: tooLong });
  }

  try {
    const ticket = await findActiveTicket(id);
    if (!ticket) {
      removeUploadedFiles(req.files);
      return res.status(404).json({ error: 'Ticket not found' });
    }

    if (!canAccessTicket(req.user, ticket)) {
      removeUploadedFiles(req.files);
      return res.status(403).json({ error: 'Access denied: You can only reply to your own tickets' });
    }

    const messageAttachments = toAttachments(req.files);

    ticket.messages.push({
      sender: req.user.userId,
      message: typeof message === 'string' ? message.trim() : '',
      attachments: messageAttachments
    });

    await ticket.save();

    await logActivity({
      user: req.user.userId,
      action: `Replied to ticket with ${messageAttachments.length} attachment(s)`,
      target: ticket._id,
      targetModel: 'Ticket'
    });

    return res.status(200).json({ message: 'Reply sent' });
  } catch (err) {
    console.error(err);
    removeUploadedFiles(req.files);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Download an attachment (owner of the ticket, admin or superadmin)
exports.downloadAttachment = async (req, res) => {
  const { ticketId, attachmentId, type } = req.params; // type: 'ticket' ou 'message'

  if (!isValidId(ticketId) || !isValidId(attachmentId)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  if (!['ticket', 'message'].includes(type)) {
    return res.status(400).json({ error: 'Type must be "ticket" or "message"' });
  }

  try {
    const ticket = await findActiveTicket(ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    // 🔒 SECURITY: before this, any logged-in user could download any file
    if (!canAccessTicket(req.user, ticket)) {
      return res.status(403).json({ error: 'Access denied: You can only download files from your own tickets' });
    }

    let attachment;
    if (type === 'ticket') {
      attachment = ticket.attachments.id(attachmentId);
    } else {
      for (const msg of ticket.messages) {
        attachment = msg.attachments.id(attachmentId);
        if (attachment) break;
      }
    }

    if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

    const safePath = storedFilePath(attachment);
    if (!safePath) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    if (!fs.existsSync(safePath)) {
      return res.status(404).json({ error: 'File not found on server' });
    }

    // res.download sets Content-Disposition correctly (accents, spaces, quotes)
    return res.download(safePath, attachment.originalName, (err) => {
      if (err && !res.headersSent) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Change status (admin / superadmin)
exports.updateStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};

  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid ticket id' });
  if (!TICKET_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Allowed: ${TICKET_STATUSES.join(', ')}` });
  }

  try {
    const ticket = await findActiveTicket(id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    // Si l'admin change le statut et n'est pas encore assigné, l'assigner automatiquement
    if (!ticket.handledBy) {
      ticket.handledBy = req.user.userId;
    }

    const oldStatus = ticket.status;
    ticket.status = status;
    // resolution date for the stats: set when it becomes "résolu",
    // cleared when an admin reopens it
    if (status === 'résolu' && oldStatus !== 'résolu') {
      ticket.resolvedAt = new Date();
    } else if (status !== 'résolu') {
      ticket.resolvedAt = null;
    }
    await ticket.save();

    await logActivity({
      user: req.user.userId,
      action: `Changed status from ${oldStatus} to ${status}`,
      target: ticket._id,
      targetModel: 'Ticket'
    });

    return res.status(200).json({
      message: 'Status updated',
      handledBy: ticket.handledBy
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Get my own tickets — urgent > high > normal > low, then newest, by default
// GET /api/tickets/my?page=1&limit=10&status=résolu&sort=newest
exports.getMyTickets = (req, res) =>
  listTickets(req, res, { onlyMine: true, defaultSort: 'priority' });

// Soft delete a ticket (admin / superadmin) — hidden but kept in the DB.
// DELETE /api/tickets/:id                  -> files stay on disk (default)
// DELETE /api/tickets/:id?deleteFiles=true -> also removes its files from disk
exports.softDeleteTicket = async (req, res) => {
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid ticket id' });

  const { deleteFiles } = req.query;
  if (deleteFiles !== undefined && deleteFiles !== 'true' && deleteFiles !== 'false') {
    return res.status(400).json({ error: '"deleteFiles" must be true or false' });
  }
  const removeFiles = deleteFiles === 'true';

  try {
    const ticket = await findActiveTicket(id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    ticket.deleted = true;
    await ticket.save();

    let filesDeleted = 0;
    if (removeFiles) {
      for (const attachment of allAttachments(ticket)) {
        const filePath = storedFilePath(attachment);
        if (!filePath) continue;
        try {
          await fs.promises.unlink(filePath);
          filesDeleted++;
        } catch (err) {
          // already gone = fine; anything else is logged but doesn't fail the delete
          if (err.code !== 'ENOENT') console.error('❌ Failed to delete file:', filePath, err.message);
        }
      }
    }

    await logActivity({
      user: req.user.userId,
      action: `Soft deleted ticket: ${ticket.subject}${removeFiles ? ` (${filesDeleted} file(s) removed)` : ''}`,
      target: ticket._id,
      targetModel: 'Ticket'
    });

    return res.status(200).json({ message: 'Ticket soft deleted', filesDeleted });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// Update ticket priority (owner, admin or superadmin)
exports.updatePriority = async (req, res) => {
  const { id } = req.params;
  const { priority } = req.body || {};

  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid ticket id' });
  if (!TICKET_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: `Invalid priority. Allowed: ${TICKET_PRIORITIES.join(', ')}` });
  }

  try {
    const ticket = await findActiveTicket(id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    if (!canAccessTicket(req.user, ticket)) {
      return res.status(403).json({ error: 'Access denied: You can only update priority of your own tickets' });
    }
    if (!canSetPriority(req.user, priority, ticket.priority)) {
      return res.status(403).json({ error: URGENT_FORBIDDEN });
    }

    const oldPriority = ticket.priority;
    ticket.priority = priority;
    await ticket.save();

    await logActivity({
      user: req.user.userId,
      action: `Changed priority from ${oldPriority} to ${priority}`,
      target: ticket._id,
      targetModel: 'Ticket'
    });

    return res.status(200).json({
      message: 'Priority updated successfully',
      oldPriority,
      newPriority: priority
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
};
