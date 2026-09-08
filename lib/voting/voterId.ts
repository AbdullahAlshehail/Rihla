// A stable, anonymous, non-PII id for a voting participant, kept in the
// visitor's localStorage. Used only to de-dupe votes and cap spam. It is sent
// to the server on writes but is NEVER shown to anyone or tied to an identity.
const KEY = "rihla_voter_id";

export function getVoterId(): string {
  if (typeof window === "undefined") return "";
  let v = window.localStorage.getItem(KEY);
  if (!v || !/^[0-9a-f-]{36}$/i.test(v)) {
    v = crypto.randomUUID();
    window.localStorage.setItem(KEY, v);
  }
  return v;
}
