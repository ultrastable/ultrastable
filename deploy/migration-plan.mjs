// MIGRATION-DRIFT-1 (Q-LESSON-DEPLOY-VERSION): the fleet this org was split from re-applied migrations whose file was edited after it ran.
// The ledger (_migrations: file, sha256) is the truth: a new file is applied; an applied file with the same sha256 is skipped; an applied file whose
// sha256 changed is drift: it is reported and never run again (a change to an applied migration ships as a new file).
// plan(files: [{ file, sha256 }], ledger: Map|object file -> sha256) -> [{ file, sha256, action: 'apply'|'skip'|'drift', was? }]
export function planMigrations(files, ledger) {
  const seen = ledger instanceof Map ? ledger : new Map(Object.entries(ledger || {}));
  return [...files].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)).map(({ file, sha256 }) => {
    if (!seen.has(file)) return { file, sha256, action: 'apply' };
    const was = seen.get(file);
    return was === sha256 ? { file, sha256, action: 'skip' } : { file, sha256, action: 'drift', was };
  });
}
