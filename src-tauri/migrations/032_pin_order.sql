-- Pin order is device-local clip organization, independent of capture recency.
ALTER TABLE clip_items ADD COLUMN pin_order INTEGER;
WITH ordered AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY rowid DESC) - 1 AS position
    FROM clip_items WHERE is_pinned=1
)
UPDATE clip_items SET pin_order=(SELECT position FROM ordered WHERE ordered.id=clip_items.id)
WHERE is_pinned=1;
CREATE INDEX clip_pinned_order ON clip_items(pin_order,id) WHERE is_pinned=1;

-- All writers (manual actions, decisions, assistant edits and undo) share this policy.
CREATE TRIGGER clip_pin_order_insert AFTER INSERT ON clip_items WHEN NEW.is_pinned=1
BEGIN
    UPDATE clip_items SET pin_order=COALESCE((SELECT MIN(pin_order) FROM clip_items WHERE is_pinned=1 AND id!=NEW.id),0)-1 WHERE id=NEW.id;
END;
CREATE TRIGGER clip_pin_order_pin AFTER UPDATE OF is_pinned ON clip_items
WHEN NEW.is_pinned=1 AND OLD.is_pinned=0
BEGIN
    UPDATE clip_items SET pin_order=COALESCE((SELECT MIN(pin_order) FROM clip_items WHERE is_pinned=1 AND id!=NEW.id),0)-1 WHERE id=NEW.id;
END;
CREATE TRIGGER clip_pin_order_unpin AFTER UPDATE OF is_pinned ON clip_items
WHEN NEW.is_pinned=0 AND OLD.is_pinned=1
BEGIN
    UPDATE clip_items SET pin_order=NULL WHERE id=NEW.id;
END;
