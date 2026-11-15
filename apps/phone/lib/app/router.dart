import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/gallery/gallery_screen.dart';

/// Every route of the app, in one place. Step 1 has the design gallery only; sign-in,
/// the five tabs and the records arrive in the next steps.
final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/gallery',
    routes: [GoRoute(path: '/gallery', builder: (context, state) => const GalleryScreen())],
  );
});
