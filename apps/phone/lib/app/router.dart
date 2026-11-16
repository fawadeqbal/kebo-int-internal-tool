import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/providers.dart';
import '../core/session.dart';
import '../design/design.dart';
import '../features/auth/presentation/sign_in_screen.dart';
import '../features/gallery/gallery_screen.dart';
import '../features/gallery/patterns_screen.dart';
import '../features/home/presentation/home_screen.dart';

/// Every route of the app, in one place. Signed out, every route leads to sign-in; signed
/// in, sign-in leads home. The design gallery stays reachable for review.
final routerProvider = Provider<GoRouter>((ref) {
  final session = ref.watch(sessionProvider.notifier);
  return GoRouter(
    initialLocation: '/home',
    refreshListenable: session,
    redirect: (context, state) {
      final at = state.matchedLocation;
      final gallery = at.startsWith('/gallery');
      return switch (session.status) {
        SessionStatus.starting => at == '/starting' ? null : '/starting',
        SessionStatus.signedOut || SessionStatus.needsCode => at == '/sign-in' || gallery ? null : '/sign-in',
        SessionStatus.signedIn => at == '/sign-in' || at == '/starting' ? '/home' : null,
      };
    },
    routes: [
      GoRoute(path: '/starting', builder: (context, state) => const _Starting()),
      GoRoute(path: '/sign-in', builder: (context, state) => const SignInScreen()),
      GoRoute(path: '/home', builder: (context, state) => const HomeScreen()),
      GoRoute(
        path: '/gallery',
        builder: (context, state) => const GalleryScreen(),
        routes: [
          GoRoute(path: 'patterns', builder: (context, state) => const PatternsScreen()),
          GoRoute(path: 'form', builder: (context, state) => const StepFormDemo()),
        ],
      ),
    ],
  );
});

/// The moment between opening the app and knowing who is signed in: the brand, nothing to do.
class _Starting extends StatelessWidget {
  const _Starting();

  @override
  Widget build(BuildContext context) {
    final c = context.k;
    return Scaffold(
      backgroundColor: c.brandSurface,
      body: Center(child: KSpinner(color: c.onBrandSurface, size: 28)),
    );
  }
}
