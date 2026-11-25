// Label names and bot constants of the GitHub automation (docs/SPEC.md §6.1).
// Label names are code constants, not configuration: the workflows' job-level `if:` filters use the same names.

export const LABELS = Object.freeze({
  FAMILY_TREE: 'family-tree',
  APPROVE: 'approve',
  APPROVE_DELETION: 'approve-deletion',
  NEEDS_CHANGES: 'needs-changes',
  APPLIED: 'applied',
  DELETION_REQUEST: 'deletion-request',
  DUPLICATE: 'duplicate',
  UNDONE: 'undone',
});

/** Labels that mean "approved" (approve-deletion also allows destructive changes). */
export const APPROVAL_LABELS = Object.freeze([LABELS.APPROVE_DELETION, LABELS.APPROVE]);

/** Definitions used to create missing labels (name, colour, bilingual description ≤ 100 chars). */
export const LABEL_DEFS = Object.freeze([
  { name: LABELS.FAMILY_TREE, color: '2e7d32', description: 'Family tree proposal · مقترح لشجرة العائلة' },
  { name: LABELS.APPROVE, color: '1a7f37', description: 'Approved by the tree keeper · موافقة المشرف' },
  { name: LABELS.APPROVE_DELETION, color: 'b60205', description: 'Approved incl. removals · موافقة تشمل الحذف' },
  { name: LABELS.NEEDS_CHANGES, color: 'fbca04', description: 'Could not be applied as is · يحتاج إلى تصحيح' },
  { name: LABELS.APPLIED, color: '0e8a16', description: 'Applied to the family tree · طُبّق على الشجرة' },
  { name: LABELS.DELETION_REQUEST, color: 'd93f0b', description: 'Contains removals · يتضمن حذفاً' },
  { name: LABELS.DUPLICATE, color: 'cfd3d7', description: 'Already applied or repeated · مكرر' },
  { name: LABELS.UNDONE, color: '5319e7', description: 'Approval undone · أُلغي التطبيق' },
]);

/** Login of the Actions bot (comments and label events made with GITHUB_TOKEN). */
export const BOT_LOGIN = 'github-actions[bot]';

/** Hidden markers inside bot comments: <!-- gft-bot:<kind> key=value … --> */
export const MARKERS = Object.freeze({
  CHECK: 'check',
  APPROVAL: 'approval',
  RESULT: 'result',
});

export const labelNames = (issue) => new Set((issue?.labels || []).map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean));
export const hasLabel = (issue, name) => labelNames(issue).has(name);
