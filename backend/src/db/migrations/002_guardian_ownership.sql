-- Each child belongs to one guardian (the logged-in user who registered it).
-- Nullable on purpose: children created before this migration have no owner and
-- are left intact. They are invisible through the API until an owner is assigned.
-- No foreign key yet: guardians are mock users defined in code; a real guardians
-- table would arrive together with a real identity provider.
ALTER TABLE children ADD COLUMN guardian_id UUID;
CREATE INDEX idx_children_guardian_id ON children (guardian_id);
