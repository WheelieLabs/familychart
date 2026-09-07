/**
 * Shared push notification action constants for sw-push.js.
 * Keep in sync with lib/push-notification-actions.ts.
 */
var FC_HYDRATION_NOTIFICATION_TYPE = "hydration"
var FC_HYDRATION_MUTE_ACTION = "mute-today"
var FC_HYDRATION_MUTE_URL = "/api/me/hydration-mute"

function fcIsHydrationMuteClick(action, data) {
  return (
    action === FC_HYDRATION_MUTE_ACTION &&
    data &&
    data.type === FC_HYDRATION_NOTIFICATION_TYPE
  )
}

function fcResolveNotificationClickMode(action, data) {
  if (!action) return "navigate"
  if (fcIsHydrationMuteClick(action, data)) return "mute"
  return "dismiss"
}
