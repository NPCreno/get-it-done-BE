/**
 * Canonical API contract. DTO decorators import these values, and
 * `pnpm contract:export` writes them to docs/api-contract.json, which the
 * frontend vendors. Changing anything here means: run contract:export, then
 * contract:sync in the FE repo.
 */
export const API_CONTRACT = {
  version: 1,
  taskPriorities: ['Low', 'Medium', 'High'],
  taskStatuses: ['Pending', 'Complete', 'Overdue'],
  newTaskStatuses: ['Pending', 'Complete'],
  repeatEvery: ['Day', 'Week', 'Month'],
  weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  themes: ['light', 'dark'],
  booleanStrings: ['true', 'false'],
  limits: {
    fullnameMin: 3,
    fullnameMax: 50,
    usernameMin: 3,
    usernameMax: 20,
    passwordMin: 6,
    passwordMax: 20,
    titleMin: 2,
    titleMax: 100,
    descriptionMax: 500,
    colorLabelMax: 50,
  },
  patterns: {
    username: '^[A-Za-z0-9_]+$',
    password: '[0-9]',
  },
} as const;

export type ApiContract = typeof API_CONTRACT;
