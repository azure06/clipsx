CREATE TABLE clip_decision_reviews (
  clip_id TEXT NOT NULL REFERENCES clip_items(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK(stage IN ('privacy','organization')),
  status TEXT NOT NULL CHECK(status IN ('completed','not_checked')),
  reason TEXT CHECK(reason IN ('input_limit','timeout','unavailable','invalid_response','other','privacy_not_checked')),
  evaluated_at INTEGER NOT NULL,
  PRIMARY KEY(clip_id,stage)
);
INSERT INTO clip_decision_reviews(clip_id,stage,status,reason,evaluated_at)
SELECT clip_id,'privacy','not_checked','other',MAX(created_at)
FROM content_clip_facets
WHERE facet_id='core.security.private' AND detector_id='builtin.privacy'
  AND json_valid(payload_json) AND json_extract(payload_json,'$.kind')='unreviewed'
GROUP BY clip_id;
DELETE FROM content_compact_presentations
WHERE facet_id='core.security.private' AND clip_id IN (SELECT clip_id FROM clip_decision_reviews);
DELETE FROM content_clip_facets
WHERE facet_id='core.security.private' AND detector_id='builtin.privacy'
  AND json_valid(payload_json) AND json_extract(payload_json,'$.kind')='unreviewed';
UPDATE system_schema_meta SET schema_version=31;
