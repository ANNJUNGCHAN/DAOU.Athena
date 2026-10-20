export async function performDisconnect({ send, onDisconnected, onRejected }) {
  try {
    await send("panel.disconnect");
    await onDisconnected();
    return true;
  } catch (error) {
    await onRejected(error);
    return false;
  }
}
