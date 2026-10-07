-- UTL core schema 1710: rewrite private.pw_text so the character list is built with chr(), not unicode escapes.
-- Migration 1700 defined pw_text with backslash-u escapes inside a regular expression. Applied through the Supabase
-- tool, some of those escapes arrived as raw characters, so the live function was not byte for byte the tested
-- one. Building the list with chr() has no escape that a transport can change. Behaviour is the same: control
-- characters (except tab and newline), zero width characters and right to left overrides are removed.

set search_path = public, extensions;

create or replace function private.pw_text(p_value jsonb, p_key text, p_min integer, p_max integer, p_default text default '')
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := p_value -> p_key;
  v_text text;
  v_strip text := '['
    || chr(1) || '-' || chr(8)
    || chr(11) || chr(12)
    || chr(14) || '-' || chr(31)
    || chr(127)
    || chr(8203) || '-' || chr(8207)
    || chr(8234) || '-' || chr(8238)
    || chr(8294) || '-' || chr(8297)
    || chr(65279)
    || ']';
begin
  if v is null or jsonb_typeof(v) = 'null' then
    if p_default is null and p_min > 0 then
      raise exception '% is required', p_key using errcode = '22023';
    end if;
    return p_default;
  end if;
  if jsonb_typeof(v) <> 'string' then
    raise exception '% must be a string', p_key using errcode = '22023';
  end if;
  -- Control characters, zero width characters and right to left overrides are removed; tab and newline stay.
  v_text := btrim(regexp_replace(v #>> '{}', v_strip, '', 'g'));
  if length(v_text) < p_min or length(v_text) > p_max then
    raise exception '% must be between % and % characters', p_key, p_min, p_max using errcode = '22023';
  end if;
  return v_text;
end
$$;

revoke execute on function private.pw_text(jsonb, text, integer, integer, text) from public, anon, authenticated;
