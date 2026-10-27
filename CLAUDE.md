<!-- claude-reflect: learned rules (saved from the band; edit freely) -->
## Learned rules
- For this platform, use Arabic and French only; do not include Darija in the first version.
<!-- end claude-reflect -->

## Project docs (read before building)
- `SPEC.md`: stack, commands, structure, conventions (integer money/grams, UUIDv7, Africa/Casablanca farm days), boundaries, M1 requirements.
- `CAPABILITY-MAP.md`: module ids and allowed dependencies. Never import across modules except via `src/modules/<id>/index.ts` of a declared dependency.
- `docs/decisions/`: ADRs. Don't re-decide an accepted ADR; write a superseding one.
- `tasks/plan.md` + `tasks/todo.md`: current milestone plan; work tasks in order, tick them when verified.
