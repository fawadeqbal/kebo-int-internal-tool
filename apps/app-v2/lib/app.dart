import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'core/scope.dart';
import 'core/session.dart';
import 'custom/coming.dart';
import 'custom/more.dart';
import 'custom/shell.dart';
import 'custom/sign_in.dart';
import 'ds/ds.dart';
import 'generated/routes.g.dart';

/// The app: theme from the web's tokens, sign-in gate, the bottom bar and every route.
class App extends StatefulWidget {
  const App({super.key, required this.session, this.initialLocation = '/home'});
  final Session session;
  final String initialLocation;

  @override
  State<App> createState() => _AppState();
}

class _AppState extends State<App> {
  late final GoRouter router = GoRouter(
    initialLocation: widget.initialLocation,
    refreshListenable: widget.session,
    redirect: (context, state) {
      final status = widget.session.status;
      final atSignIn = state.matchedLocation == '/sign-in';
      if (status == SessionStatus.starting) return null;
      if (status != SessionStatus.signedIn) return atSignIn ? null : '/sign-in';
      return atSignIn ? '/home' : null;
    },
    routes: [
      GoRoute(path: '/sign-in', builder: (c, s) => const SignInScreen()),
      ShellRoute(
        builder: (c, s, child) => Shell(location: s.matchedLocation, child: child),
        routes: [
          GoRoute(path: '/home', builder: (c, s) => const ComingScreen(title: 'Home', phase: 'phase 1')),
          GoRoute(path: '/inquiries', builder: (c, s) => const ComingScreen(title: 'Inquiries', phase: 'phase 2')),
          GoRoute(path: '/orders', builder: (c, s) => const ComingScreen(title: 'Orders', phase: 'phase 3')),
          GoRoute(path: '/more', builder: (c, s) => const MoreScreen()),
          ...generatedRoutes,
        ],
      ),
    ],
  );

  @override
  void dispose() {
    router.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AppScope(
        session: widget.session,
        child: MaterialApp.router(
          title: appName,
          debugShowCheckedModeBanner: false,
          theme: appTheme(Brightness.light),
          darkTheme: appTheme(Brightness.dark),
          routerConfig: router,
        ),
      );
}
