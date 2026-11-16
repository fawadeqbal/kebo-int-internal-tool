import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import 'api.dart';

/// Pages of the phone app that a web link can land on. Records join as their steps ship
/// (sales in step 5, orders in step 6, money in step 7).
const appPages = {'/home', '/alerts', '/needs', '/follow-ups', '/more', '/approvals'};

/// The app page for a web link (`/needs?x=1` → `/needs`), or null when it isn't in the app yet.
String? appPathFor(String? href) {
  if (href == null || !href.startsWith('/')) return null;
  final path = Uri.parse(href).path;
  if (path == '/dashboard' || path == '/') return '/home';
  if (path == '/submissions' || path == '/approvals') return '/approvals';
  if (path == '/inquiries') return '/sales';
  final inquiry = RegExp(r'^/inquiries/([0-9a-fA-F-]{36})').firstMatch(path);
  if (inquiry != null) return '/sales/inquiry/${inquiry.group(1)}';
  if (path == '/orders') return '/orders';
  final customer = RegExp(r'^/customers/([0-9a-fA-F-]{36})').firstMatch(path);
  if (customer != null) return '/partners/customer/${customer.group(1)}';
  final factory = RegExp(r'^/factories/([0-9a-fA-F-]{36})').firstMatch(path);
  if (factory != null) return '/partners/factory/${factory.group(1)}';
  final order = RegExp(r'^/orders/([0-9a-fA-F-]{36})').firstMatch(path);
  if (order != null) return '/orders/order/${order.group(1)}';
  return appPages.contains(path) ? path : null;
}

/// Opens [href] in the app when the page is here; otherwise on the web, in the browser.
Future<void> openLink(BuildContext context, Api api, String? href) async {
  final inApp = appPathFor(href);
  if (inApp != null) {
    if (inApp == '/home' || inApp == '/more' || inApp == '/sales' || inApp == '/orders') {
      context.go(inApp);
    } else {
      await context.push(inApp);
    }
    return;
  }
  if (href == null) return;
  await launchUrl(Uri.parse('${api.server}$href'), mode: LaunchMode.externalApplication);
}

/// Opens a file of the system: PDFs and photos in the app's viewer, anything else on the web.
Future<void> openFile(BuildContext context, Api api, String href, String name) async {
  final path = href.startsWith('/api/') ? href : '/api$href';
  if (RegExp(r'\.(pdf|jpe?g|png|webp|gif|heic)$', caseSensitive: false).hasMatch(name)) {
    await context.push(Uri(path: '/file', queryParameters: {'path': path, 'name': name}).toString());
    return;
  }
  await launchUrl(
    Uri.parse('${api.server}${href.startsWith('/api/') ? href : path}'),
    mode: LaunchMode.externalApplication,
  );
}
