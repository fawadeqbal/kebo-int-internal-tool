import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import 'core/scope.dart';
import 'core/session.dart';
import 'custom/alerts.dart';
import 'custom/approvals.dart';
import 'custom/record_follow_ups.dart';
import 'custom/home.dart';
import 'custom/more.dart';
import 'custom/search.dart';
import 'custom/shell.dart';
import 'custom/sign_in.dart';
import 'custom/waiting.dart';
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

class _AppState extends State<App> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  /// Back to the front: is there signal now? (Sends what waits when there is.)
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && widget.session.api.net.offline) widget.session.api.net.check().ignore();
  }

  late final GoRouter router = GoRouter(
    initialLocation: widget.initialLocation,
    refreshListenable: widget.session,
    redirect: (context, state) {
      final status = widget.session.status;
      final atSignIn = state.matchedLocation == '/sign-in';
      if (status == SessionStatus.starting) return null;
      if (status != SessionStatus.signedIn) {
        // Remember where the person was going, to go there after signing in.
        return atSignIn ? null : Uri(path: '/sign-in', queryParameters: state.uri.path == '/home' ? null : {'from': state.uri.toString()}).toString();
      }
      if (!atSignIn) return null;
      final from = state.uri.queryParameters['from'];
      return from != null && from.startsWith('/') && !from.startsWith('//') ? from : '/home';
    },
    routes: [
      GoRoute(path: '/sign-in', builder: (c, s) => const SignInScreen()),
      ShellRoute(
        builder: (c, s, child) => Shell(location: s.matchedLocation, child: child),
        routes: [
          GoRoute(path: '/home', builder: (c, s) => const HomeScreen()),
          GoRoute(path: '/needs', builder: (c, s) => const NeedsScreen()),
          GoRoute(path: '/alerts', builder: (c, s) => const AlertsScreen()),
          GoRoute(path: '/search', builder: (c, s) => const SearchScreen()),
          GoRoute(path: '/more', builder: (c, s) => const MoreScreen()),
          GoRoute(path: '/approvals', builder: (c, s) => const ApprovalsScreen()),
          GoRoute(path: '/follow-ups', builder: (c, s) => const FollowUpsScreen()),
          GoRoute(path: '/waiting', builder: (c, s) => const WaitingScreen()),
          ...generatedRoutes,
        ],
      ),
    ],
  );

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.session.api.net.stop();
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
