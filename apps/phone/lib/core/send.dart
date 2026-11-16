import 'package:flutter/widgets.dart';

import '../design/design.dart';
import 'session.dart';

/// Sends a change now, or keeps it on the phone when there's no signal (sent when back).
/// Says which happened. Throws the server's [ApiException] for anything else.
Future<bool> sendOrKeep(BuildContext context, Session s, String label, String method, String path, Object? body) async {
  final chain = s.outbox.chain(label);
  switch (method) {
    case 'POST':
      chain.post(path, body);
    case 'PUT':
      chain.put(path, body);
    default:
      chain.patch(path, body);
  }
  final sent = await chain.send();
  if (context.mounted) {
    if (sent.queued) {
      showKToast(context, 'Saved on this phone. It is sent when you are back online.', icon: KIcons.wifiOff);
    } else {
      KHaptics.success();
    }
  }
  return !sent.queued;
}
