-- UTL core schema 0900: storage bucket for organization logos.
-- The bucket is public because logos are brand assets shown before sign-in. Only the service role uploads.
-- Always render logos through an img tag so an svg can never run script.
-- Skipped automatically when the storage schema is not present.

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('org-brand', 'org-brand', true, 1048576, array['image/png', 'image/svg+xml', 'image/webp'])
    on conflict (id) do nothing;
  end if;
end
$$;
