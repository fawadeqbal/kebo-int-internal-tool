import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/gallery/gallery_screen.dart';
import '../features/gallery/patterns_screen.dart';

/// Every route of the app, in one place. Steps 1–2 have the design gallery only; sign-in,
/// the five tabs and the records arrive in the next steps.
final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/gallery',
    routes: [
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
