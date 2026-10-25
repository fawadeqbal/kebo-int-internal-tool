import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/push.dart';
import 'core/refresh.dart';
import 'core/session.dart';
import 'features/auth/auth_screens.dart';
import 'features/customers/customers.dart';
import 'features/dashboard/dashboard.dart';
import 'features/inquiries/inquiries.dart';
import 'features/inquiries/inquiry_detail.dart';
import 'features/inquiries/inquiry_form.dart';
import 'features/invoices/invoices.dart';
import 'features/more/account.dart';
import 'features/more/admin.dart';
import 'features/more/more.dart';
import 'features/more/notifications.dart';
import 'features/more/reports.dart';
import 'features/packing/packing.dart';
import 'features/quotations/quotations.dart';
import 'features/shell/shell.dart';
import 'features/sourcing/sourcing.dart';
import 'theme/theme.dart';

class KeboApp extends ConsumerStatefulWidget {
  const KeboApp({super.key});
  @override
  ConsumerState<KeboApp> createState() => _KeboAppState();
}

class _KeboAppState extends ConsumerState<KeboApp> {
  late final _refresh = ValueNotifier<int>(0);
  late final GoRouter _router = _buildRouter();
  final _messenger = GlobalKey<ScaffoldMessengerState>();
  final _subs = <StreamSubscription<dynamic>>[];
  /// A tapped notification waiting for sign-in to finish.
  String? _pendingLink;

  @override
  void initState() {
    super.initState();
    _subs.add(Push.onOpened.listen((m) => _openLink(m.data['link'])));
    _subs.add(Push.onForeground.listen(_showForeground));
    Push.initial().then((m) {
      if (m != null) _openLink(m.data['link']);
    });
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    _refresh.dispose();
    super.dispose();
  }

  void _openLink(Object? link) {
    final route = appRoute(link?.toString()) ?? '/notifications';
    if (ref.read(sessionProvider).status == SessionStatus.signedIn) {
      _router.push(route);
    } else {
      _pendingLink = route;
    }
  }

  /// A push while the app is open: refresh the badge and lists, and show it as a banner.
  void _showForeground(RemoteMessage m) {
    if (ref.read(sessionProvider).status != SessionStatus.signedIn) return;
    ref.read(dataVersionProvider.notifier).bump();
    unawaited(ref.read(sessionProvider.notifier).refreshMe().catchError((_) {}));
    final title = m.notification?.title ?? 'New notification';
    final body = m.notification?.body;
    _messenger.currentState?.showSnackBar(SnackBar(
      duration: const Duration(seconds: 6),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
        if (body != null && body.isNotEmpty) Text(body, maxLines: 2, overflow: TextOverflow.ellipsis),
      ]),
      action: SnackBarAction(label: 'Open', onPressed: () => _openLink(m.data['link'])),
    ));
  }

  GoRouter _buildRouter() {
    ref.listenManual(sessionProvider, (prev, next) {
      if (prev?.status != next.status) _refresh.value++;
      if (next.status == SessionStatus.signedIn && prev?.status != SessionStatus.signedIn) {
        unawaited(Push.register(ref.read(apiProvider)));
        final pending = _pendingLink;
        if (pending != null) {
          _pendingLink = null;
          Future.delayed(const Duration(milliseconds: 400), () => _router.push(pending));
        }
      }
    });
    return GoRouter(
      initialLocation: '/home',
      refreshListenable: _refresh,
      redirect: (context, state) {
        final s = ref.read(sessionProvider).status;
        final loc = state.matchedLocation;
        switch (s) {
          case SessionStatus.loading:
            return loc == '/splash' ? null : '/splash';
          case SessionStatus.signedOut:
            return loc == '/login' ? null : '/login';
          case SessionStatus.needsCode:
            return loc == '/login/code' ? null : '/login/code';
          case SessionStatus.needsSetup:
            return loc == '/two-step/setup' ? null : '/two-step/setup';
          case SessionStatus.signedIn:
            if (loc == '/splash' || loc.startsWith('/login') || loc == '/two-step/setup') return '/home';
            return null;
        }
      },
      routes: [
        GoRoute(path: '/splash', builder: (_, _) => const SplashScreen()),
        GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
        GoRoute(path: '/login/code', builder: (_, _) => const CodeScreen()),
        GoRoute(path: '/two-step/setup', builder: (_, _) => const TwoStepSetupScreen()),
        StatefulShellRoute.indexedStack(
          builder: (context, state, shell) => AppShell(shell: shell),
          branches: [
            StatefulShellBranch(routes: [GoRoute(path: '/home', builder: (_, _) => const DashboardScreen())]),
            StatefulShellBranch(routes: [GoRoute(path: '/inquiries', builder: (_, s) => InquiriesScreen(initialStatus: s.uri.queryParameters['status']))]),
            StatefulShellBranch(routes: [GoRoute(path: '/customers', builder: (_, _) => const CustomersScreen())]),
            StatefulShellBranch(routes: [GoRoute(path: '/quotations', builder: (_, _) => const QuotationsScreen())]),
            StatefulShellBranch(routes: [GoRoute(path: '/more', builder: (_, _) => const MoreScreen())]),
          ],
        ),
        // Inquiries
        GoRoute(path: '/inquiries/new', builder: (_, s) => InquiryFormScreen(customerId: s.uri.queryParameters['customer'])),
        GoRoute(path: '/inquiries/:id', builder: (_, s) => InquiryDetailScreen(id: s.pathParameters['id']!)),
        GoRoute(path: '/inquiries/:id/edit', builder: (_, s) => InquiryFormScreen(editId: s.pathParameters['id'])),
        // Factories
        GoRoute(path: '/factories', builder: (_, _) => const FactoriesScreen()),
        GoRoute(path: '/factories/new', builder: (_, _) => const FactoryFormScreen()),
        GoRoute(path: '/factories/:id', builder: (_, s) => FactoryDetailScreen(id: s.pathParameters['id']!)),
        GoRoute(path: '/factories/:id/edit', builder: (_, s) => FactoryFormScreen(editId: s.pathParameters['id'])),
        // Customers
        GoRoute(path: '/customers/new', builder: (_, _) => const CustomerFormScreen()),
        GoRoute(path: '/customers/:id', builder: (_, s) => CustomerDetailScreen(id: s.pathParameters['id']!)),
        GoRoute(path: '/customers/:id/edit', builder: (_, s) => CustomerFormScreen(editId: s.pathParameters['id'])),
        // Quotations
        GoRoute(path: '/quotations/new', builder: (_, s) => QuotationFormScreen(queryId: s.uri.queryParameters['query'])),
        GoRoute(path: '/quotations/:id', builder: (_, s) => QuotationDetailScreen(id: s.pathParameters['id']!)),
        GoRoute(path: '/quotations/:id/edit', builder: (_, s) => QuotationFormScreen(editId: s.pathParameters['id'])),
        // Invoices
        GoRoute(path: '/invoices', builder: (_, _) => const InvoicesScreen()),
        GoRoute(path: '/invoices/new', builder: (_, s) => InvoiceFormScreen(quotationId: s.uri.queryParameters['quotation']!)),
        GoRoute(path: '/invoices/:id', builder: (_, s) => InvoiceDetailScreen(id: s.pathParameters['id']!)),
        // Packing lists
        GoRoute(path: '/packing-lists/new', builder: (_, s) => PackingFormScreen(invoiceId: s.uri.queryParameters['invoice'])),
        GoRoute(path: '/packing-lists/:id', builder: (_, s) => PackingDetailScreen(id: s.pathParameters['id']!)),
        GoRoute(path: '/packing-lists/:id/edit', builder: (_, s) => PackingFormScreen(editId: s.pathParameters['id'])),
        // More
        GoRoute(path: '/notifications', builder: (_, _) => const NotificationsScreen()),
        GoRoute(path: '/reports', builder: (_, _) => const ReportsScreen()),
        GoRoute(path: '/users', builder: (_, _) => const UsersScreen()),
        GoRoute(path: '/users/new', builder: (_, _) => const UserFormScreen()),
        GoRoute(path: '/users/:id', builder: (_, s) => UserDetailScreen(id: s.pathParameters['id']!)),
        GoRoute(path: '/settings', builder: (_, _) => const SettingsScreen()),
        GoRoute(path: '/audit', builder: (_, _) => const AuditScreen()),
        GoRoute(path: '/account', builder: (_, _) => const AccountScreen()),
        GoRoute(path: '/account/two-step', builder: (_, _) => const TwoStepSetupScreen(fromAccount: true)),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final mode = ref.watch(themeModeProvider);
    return MaterialApp.router(
      title: 'Kebo RFQ Desk',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(Brightness.light),
      darkTheme: buildTheme(Brightness.dark),
      themeMode: mode,
      routerConfig: _router,
      scaffoldMessengerKey: _messenger,
    );
  }
}

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});
  @override
  Widget build(BuildContext context) => const Scaffold(body: Center(child: BrandMark(size: 56)));
}
