-- Saving a connection may switch its provider (e.g. TronGrid -> Tronscan); admin-only via connections_write RLS.
grant update (provider) on public.provider_connections to authenticated;
