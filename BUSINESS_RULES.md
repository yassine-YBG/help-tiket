# Tiket Help — business rules

The rules the app follows, in plain words. **The backend enforces every rule**; the frontend
only hides buttons that would be refused anyway. Each phase starts by updating this file.

Roles: **user** (opens tickets) · **admin** (support team) · **superadmin** (manages everything).
**The superadmin can do everything an admin can, and more.** Rules below that say "admin" are about
the admin role; the superadmin's extra rights are written next to them.

## 1. Accounts
- Anyone can register; a new account is **inactive** until an admin or the superadmin activates it.
- The role is never chosen at registration (always `user`).
- Who manages accounts (activate, deactivate, delete, restore):
  - an **admin** manages only accounts with role **user**;
  - the **superadmin** manages **everyone**;
  - **nobody** acts on their **own** account (no self-delete, self-deactivate, self-demote).
- Only the **superadmin** changes roles.
- Delete is **soft**: the account is blocked and hidden, can be listed (`?deleted=true`) and restored.
- Deactivated / deleted accounts are refused **immediately** (the token is checked against the database on every request).
- Changing your password logs out every other session (old tokens are refused).
- When a **support account stops working** (deactivated, deleted, or demoted to user), its **open tickets
  go back to the team** (unassigned). Resolved tickets keep their handler (history and stats).

## 2. Tickets — creating and priority
- A user creates tickets (subject ≤ 150, category ≤ 50, description ≤ 5000 characters, up to 5 files of 10 MB).
- Priorities: low, normal, high, **urgent**. **Urgent is decided by support**: a user can never set or
  raise a ticket to urgent; they may keep or lower it.
- A user only sees **their own** tickets; support sees all tickets.
- Users never see support's emails or roles.

## 3. Tickets — who handles a ticket
- **One handler per ticket.** Support **replies, changes the status or the priority only on a ticket
  assigned to them** ("Assign to me").
- An admin can **take over** another admin's ticket (the app asks for confirmation).
- A ticket held by the **superadmin** cannot be taken by an admin; only another superadmin can take it.
- The superadmin can take any ticket.
- The **owner** can always reply to and change the priority of their own **open** ticket.

## 4. Tickets — status and closing
- Status: **Open** (non résolu) → **In progress** (en cours, when support takes it) → **Resolved** (résolu).
- **A resolved ticket is closed**: nobody can write in it (owner or support). The owner opens a new
  ticket (the app pre-fills a "Follow-up"); support can reopen it by setting the status back first.
- **No ticket is ever deleted.** Support can **archive** a resolved ticket ("Closed by support"):
  - only the admin handling it, or the superadmin;
  - it leaves the admin lists (visible with the "Archived" filter) but the **owner still sees it**;
  - setting a status other than resolved, or "Restore", brings it back. Files are never removed.

## 5. Alerts — who must act next
- **Needs reply** (support side): the owner wrote last or nobody answered a new ticket yet.
  Cleared when support replies or the ticket is resolved.
- **New answer** (owner side): support replied or changed the status since the owner last opened the
  ticket. Cleared when the owner opens it.
- Menu counters (refreshed every 30 s, and with the Refresh button): *My tickets* (new answers),
  *All tickets* (needs reply), *Pending accounts* (accounts waiting for activation).

## 6. Dashboard (Phase 4)
- Admins and the superadmin see: ticket totals, status / priority / category charts, created vs resolved
  over time, first response and resolution times, users summary — for a chosen period.
- The **team table** (each admin's handled / resolved tickets and average time) is **superadmin only**.

## 7. Activity logs (Phase 4)
- Every important action is logged (who, what, when, on which ticket / account).
- **Admins see every action except the superadmin's**; the superadmin sees everything.
- Filters: person, type (tickets / accounts), dates. Logs are never edited or deleted from the app.
