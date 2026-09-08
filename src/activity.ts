import { createActivityStore } from './activity-store'
export const activityStore = createActivityStore(window.localStorage)
