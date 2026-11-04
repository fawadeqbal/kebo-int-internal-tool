import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/scope.dart';
import '../ds/ds.dart';
import '../generated/routes.g.dart';

final _uuid = RegExp(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', caseSensitive: false);

/// The app page for a web link (`/orders/<id>?tab=money` → `/orders/<id>`), or null
/// when that page is not in the app yet.
String? appPathFor(String? href) {
  if (href == null || !href.startsWith('/')) return null;
  final path = Uri.parse(href).path;
  // Pages of the app that are not records (alerts link to them).
  if (const {'/approvals', '/alerts', '/needs', '/follow-ups'}.contains(path)) return path;
  for (final r in routeTabs.keys) {
    final m = RegExp('^${RegExp.escape(r)}/(${_uuid.pattern})').firstMatch(path);
    if (m != null) return '$r/${m.group(1)}';
    if (path == r) return r;
  }
  return null;
}

/// Opens [href] on the web, in the phone's browser.
Future<void> openWeb(BuildContext context, String href) async {
  final ok = await launchUrl(Uri.parse('${context.api.server}$href'), mode: LaunchMode.externalApplication);
  if (!ok && context.mounted) toast(context, 'Open this on the web: $href');
}

/// Opens [href] in the app when the page is here; otherwise on the web.
Future<void> openLink(BuildContext context, String? href) async {
  final inApp = appPathFor(href);
  if (inApp != null) return openPage(context, inApp);
  if (href == null) return;
  final ok = await launchUrl(Uri.parse('${context.api.server}$href'), mode: LaunchMode.externalApplication);
  if (!ok && context.mounted) toast(context, 'Open this on the web: $href');
}
