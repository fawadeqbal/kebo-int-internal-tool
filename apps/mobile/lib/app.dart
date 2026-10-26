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
import 'features/deals/deal_detail.dart';
import 'features/deals/deal_form.dart';
import 'features/deals/deals.dart';
import 'features/more/account.dart';
import 'features/more/more.dart';
import 'features/more/notifications.dart';
import 'features/orders/order_detail.dart';
import 'features/orders/orders.dart';
import 'features/quotations/quotation.dart';
import 'features/shell/shell.dart';
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
    _subs.add(Push.onShadeTap.listen(_openLink));
    Push.initial().then((m) {
      if (m != null) _openLink(m.data['link']);
    });
    Push.launchLink().then((link) {
      if (link != null) _openLink(link);
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

  /// Push links are `/deals/<id>` or `/orders/<id>`.
  void _openLink(Object? link) {
    final route = appRoute(link?.toString()) ?? '/notifications';
    if (ref.read(sessionProvider).status == SessionStatus.signedIn) {
      _router.push(route);
    } else {
      _pendingLink = route;
    }
  }

  /// A push while the app is open: refresh the badge and lists, and put it in the phone's
  /// notification shade like any other notification, so several stack up instead of replacing each other.
  void _showForeground(RemoteMessage m) {
    if (ref.read(sessionProvider).status != SessionStatus.signedIn) return;
    ref.read(dataVersionProvider.notifier).bump();
    unawaited(Push.showInShade(m));
  }

  GoRouter _buildRouter() {
    ref.listenManual(sessionProvider, (prev, next) {
      if (prev?.status != next.status) _refresh.value++;
      if (next.status == SessionStatus.signedIn && prev?.status != SessionStatus.signedIn) {
        unawaited(Push.register(ref.read(repoProvider)));
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
          case SessionStatus.signedIn:
            if (loc == '/splash' || loc.startsWith('/login')) return '/home';
            return null;
        }
      },
      routes: [
        GoRoute(path: '/splash', builder: (_, _) => const SplashScreen()),
        GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
        GoRoute(path: '/login/code', builder: (_, _) => const CodeScreen()),
        StatefulShellRoute.indexedStack(
          builder: (context, state, shell) => AppShell(shell: shell),
          branches: [
            StatefulShellBranch(routes: [GoRoute(path: '/home', builder: (_, _) => const DashboardScreen())]),
            StatefulShellBranch(routes: [GoRoute(path: '/deals', builder: (_, s) => DealsScreen(initialStage: s.uri.queryParameters['stage']))]),
            StatefulShellBranch(routes: [GoRoute(path: '/orders', builder: (_, _) => const OrdersScreen())]),
            StatefulShellBranch(routes: [GoRoute(path: '/customers', builder: (_, _) => const CustomersScreen())]),
            StatefulShellBranch(routes: [GoRoute(path: '/more', builder: (_, _) => const MoreScreen())]),
          ],
        ),
        // Deals
        GoRoute(path: '/deals/new', builder: (_, s) => DealFormScreen(customerId: s.uri.queryParameters['customer'])),
        GoRoute(path: '/deals/:id', builder: (_, s) => DealDetailScreen(id: s.pathParameters['id']!)),
        GoRoute(path: '/deals/:id/quotation', builder: (_, s) => QuotationScreen(dealId: s.pathParameters['id']!)),
        // Orders
        GoRoute(path: '/orders/:id', builder: (_, s) => OrderDetailScreen(id: s.pathParameters['id']!)),
        // Customers
        GoRoute(path: '/customers/new', builder: (_, _) => const CustomerFormScreen()),
        GoRoute(path: '/customers/:id', builder: (_, s) => CustomerDetailScreen(id: s.pathParameters['id']!)),
        // More
        GoRoute(path: '/notifications', builder: (_, _) => const NotificationsScreen()),
        GoRoute(path: '/account', builder: (_, _) => const AccountScreen()),
        GoRoute(path: '/account/two-step', builder: (_, _) => const TwoStepSetupScreen()),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final mode = ref.watch(themeModeProvider);
    return MaterialApp.router(
      title: 'Kebo',
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
