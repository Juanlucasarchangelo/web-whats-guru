/** Pure decision: a number with no authorized teams is accessible to all active members. */
export function mayAccessChannel(role, permittedTeams, memberTeams) {
  if (role === 'owner' || role === 'admin') return true;
  const allowed = Array.isArray(permittedTeams) ? permittedTeams : [];
  if (!allowed.length) return true;
  const member = memberTeams instanceof Set ? memberTeams : new Set(memberTeams);
  return allowed.some(id=>member.has(id));
}
