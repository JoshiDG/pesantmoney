-- Tracks which native-OS-notification conditions have already fired, so the
-- periodic notification check (see services::notifications) does not re-fire
-- a notification every time it polls while a condition remains true.
--
-- `condition_type` distinguishes the two kinds of notification ("upcoming_bill",
-- "category_overspend"); `condition_key` identifies the specific instance of
-- that condition (e.g. "<recurring_item_id>:<next_expected_date>" for a bill,
-- "<category_id>:<month>" for an overspend). A row's presence means "already
-- notified for this exact condition"; rows are deleted once the underlying
-- condition is no longer true, so a resolved-then-recurring condition
-- notifies again.
CREATE TABLE notification_log (
    condition_type TEXT NOT NULL,
    condition_key TEXT NOT NULL,
    notified_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (condition_type, condition_key)
);
