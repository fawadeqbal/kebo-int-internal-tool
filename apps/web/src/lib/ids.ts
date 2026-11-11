/** A record id as the API gives it. The one check, for pages and routes that take an id from the address. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string | null | undefined): value is string => !!value && UUID.test(value);
