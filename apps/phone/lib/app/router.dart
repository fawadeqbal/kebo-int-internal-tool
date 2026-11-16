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
import '../features/more/presentation/more_screen.dart';
import '../features/approvals/approvals_screen.dart';
import '../features/files/file_viewer_screen.dart';
import '../features/money/presentation/money_screen.dart';
import '../features/papers/paper_screen.dart';
import '../features/partners/presentation/partner_screens.dart';
import '../features/partners/presentation/partners_screen.dart';
import '../features/search/search_screen.dart';
import '../features/notifications/presentation/alerts_screen.dart';
import '../features/orders/presentation/order_screen.dart';
import '../features/orders/presentation/orders_screen.dart';
import '../features/sales/presentation/factory_prices_screen.dart';
import '../features/sales/presentation/inquiry_screen.dart';
import '../features/sales/presentation/quotation_editor_screen.dart';
import '../features/sales/presentation/new_inquiry_screen.dart';
import '../features/sales/presentation/sales_screen.dart';
import 'shell.dart';

/// Every route of the app, in one place: the five tabs (each with its own stack), and the
/// pages above them. Signed out, every route leads to sign-in; signed in, sign-in leads home.
/// The design gallery stays reachable for review.
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
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppShell(shell),
        branches: [
          StatefulShellBranch(
            routes: [GoRoute(path: '/home', builder: (context, state) => const HomeScreen())],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/sales',
                builder: (context, state) => const SalesScreen(),
                routes: [
                  GoRoute(
                    path: 'inquiry/:id',
                    builder: (context, state) => InquiryScreen(id: state.pathParameters['id']!),
                    routes: [
                      GoRoute(
                        path: 'prices',
                        builder: (context, state) => FactoryPricesScreen(inquiryId: state.pathParameters['id']!),
                      ),
                      GoRoute(
                        path: 'quote',
                        builder: (context, state) => QuotationEditorScreen(
                          inquiryId: state.pathParameters['id']!,
                          revisionId: state.uri.queryParameters['rev'],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/orders',
                builder: (context, state) => const OrdersScreen(),
                routes: [
                  GoRoute(
                    path: 'order/:id',
                    builder: (context, state) => OrderScreen(id: state.pathParameters['id']!),
                    routes: [
                      GoRoute(
                        path: 'paper/:kind',
                        builder: (context, state) => PaperScreen(
                          orderId: state.pathParameters['id']!,
                          kind: state.pathParameters['kind']!,
                          paperRef: state.uri.queryParameters['ref'],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/money', builder: (context, state) => const MoneyScreen())],
          ),
          StatefulShellBranch(
            routes: [GoRoute(path: '/more', builder: (context, state) => const MoreScreen())],
          ),
        ],
      ),
      GoRoute(path: '/sales/new', builder: (context, state) => const NewInquiryScreen()),
      GoRoute(path: '/approvals', builder: (context, state) => const ApprovalsScreen()),
      GoRoute(path: '/search', builder: (context, state) => const SearchScreen()),
      GoRoute(
        path: '/partners',
        builder: (context, state) => PartnersScreen(factories: state.uri.queryParameters['kind'] == 'factories'),
        routes: [
          GoRoute(
            path: 'customer/:id',
            builder: (context, state) => CustomerScreen(id: state.pathParameters['id']!),
          ),
          GoRoute(
            path: 'factory/:id',
            builder: (context, state) => FactoryScreen(id: state.pathParameters['id']!),
          ),
        ],
      ),
      GoRoute(
        path: '/file',
        builder: (context, state) => FileViewerScreen(
          path: state.uri.queryParameters['path']!,
          name: state.uri.queryParameters['name'] ?? 'File',
        ),
      ),
      GoRoute(path: '/alerts', builder: (context, state) => const AlertsScreen()),
      GoRoute(path: '/needs', builder: (context, state) => const NeedsScreen()),
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
