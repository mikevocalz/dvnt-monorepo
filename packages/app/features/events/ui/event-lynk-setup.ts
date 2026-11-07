/** Shared setup copy. A draft selection is not a created or live room. */
export const EVENT_LYNK_SETUP = {
  label: "Add an event Lynk",
  description: "Create a private room linked to this event when you publish.",
  draftTitle: "Event Lynk included",
  draftStatus: "Created on publish · not live yet",
  linkedTitle: "Event Lynk linked",
  linkedStatus: "Manage entry from the event page",
  steps: [
    "You or an accepted admin/editor co-organizer starts the room from the event page.",
    "Members sign in and wait for the host. Tickets or invitations, verification and available space determine entry.",
    "Your hosting plan’s time and capacity limits apply. Publishing the event does not start the Lynk.",
  ],
} as const;
export interface EventLynkSetupProps {
  enabled: boolean;
  onChange?: (enabled: boolean) => void;
  linked?: boolean;
}
