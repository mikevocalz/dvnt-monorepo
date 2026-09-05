/** Recipient-authorized DM thumbnails; all original text survives extension failure. */
module.exports = {
  type: "notification-service",
  name: "DVNTNotificationService",
  displayName: "DVNT",
  bundleIdentifier: "com.dvnt.app.notifications",
  deploymentTarget: "15.1",
  frameworks: ["UserNotifications", "ImageIO"],
};
