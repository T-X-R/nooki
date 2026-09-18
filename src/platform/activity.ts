import { createActivityStore } from './activity-store.ts'
export const activityStore = createActivityStore(window.localStorage)
