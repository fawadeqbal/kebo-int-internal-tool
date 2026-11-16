import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api.dart';
import '../../../core/json.dart';
import '../../../core/providers.dart';

/// One thing that needs me: `{ title, detail, level: bad|warn|info, href }`.
class Need {
  const Need({required this.title, this.detail, this.level = 'info', this.href});
  factory Need.fromJson(Json j) => Need(
    title: j.str('title'),
    detail: j.strOrNull('detail'),
    level: j.str('level', 'info'),
    href: j.strOrNull('href'),
  );
  final String title;
  final String? detail, level, href;
}

/// My open follow-up due today or earlier.
class FollowUp {
  const FollowUp({
    required this.id,
    required this.title,
    required this.dueOn,
    this.dueAt,
    this.place,
    this.target,
    this.link,
    this.late = false,
    this.needsNext = false,
    this.canDone = true,
  });

  factory FollowUp.fromJson(Json j) => FollowUp(
    id: j.str('id'),
    title: j.str('title'),
    dueOn: j.str('dueOn'),
    dueAt: j.strOrNull('dueAt'),
    place: j.strOrNull('place'),
    target: j.at('target.label'),
    link: j.strOrNull('link'),
    late: j.boolean('late'),
    needsNext: j.boolean('needsNext'),
    canDone: j.objAt('can') == null || j.boolAt('can.done'),
  );

  final String id, title, dueOn;
  final String? dueAt, place, target, link;
  final bool late, needsNext, canDone;
}

/// This month's figures: amounts are the API's decimal strings.
class Month {
  const Month({
    this.currency,
    this.won,
    this.received,
    this.quoted,
    this.toReceive,
    this.openOrders = 0,
    this.targetPercent,
  });
  final String? currency, won, received, quoted, toReceive;
  final int openOrders;
  final int? targetPercent;
}

class HomeData {
  const HomeData({required this.needs, required this.needsTotal, required this.today, required this.month});
  final List<Need> needs;
  final int needsTotal;
  final List<FollowUp> today;
  final Month? month;
}

/// Home reads four things at once. Needs is required; the rest leave their card out when
/// they fail (a role without money sees no money).
final homeProvider = FutureProvider.autoDispose<HomeData>((ref) async {
  final api = ref.watch(sessionProvider.notifier).api;
  Future<Json> soft(String path) =>
      api.get(path).catchError((Object _) => <String, dynamic>{}, test: (e) => e is ApiException);
  final r = await Future.wait([
    api.get('/api/reminders'),
    soft('/api/me/today'),
    soft('/api/dashboard'),
    soft('/api/me/target'),
  ]);
  final money = r[2].objAt('money');
  final pct = r[3]['percent'];
  return HomeData(
    needs: r[0].list('items', Need.fromJson),
    needsTotal: r[0].objAt('counts')?.integer('total') ?? r[0].list('items', (m) => m).length,
    today: r[1].list('rows', FollowUp.fromJson),
    month: money == null
        ? null
        : Month(
            currency: money.strOrNull('currency'),
            won: money.at('thisMonth.won'),
            received: money.at('thisMonth.received'),
            quoted: money.at('thisMonth.quoted'),
            toReceive: money.at('now.toReceive'),
            openOrders: money.objAt('now')?.integer('openOrders') ?? 0,
            targetPercent: r[3].strOrNull('target') == null || pct is! num ? null : pct.round(),
          ),
  );
});

/// Everything that needs me, most urgent first.
final needsProvider = FutureProvider.autoDispose<List<Need>>((ref) async {
  final api = ref.watch(sessionProvider.notifier).api;
  return (await api.get('/api/reminders')).list('items', Need.fromJson);
});
