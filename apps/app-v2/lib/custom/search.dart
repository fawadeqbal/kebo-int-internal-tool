import 'dart:async';

import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/json.dart';
import '../core/scope.dart';
import '../ds/ds.dart';
import '../generated/countries.g.dart';
import '../generated/enums.g.dart';
import 'links.dart';

/// What was searched lately on this phone (kept while the app runs).
final _recent = <String>[];

/// One search box for everything: orders, customers, inquiries, factories,
/// results grouped by kind. Orders match number, customer, product or B/L.
class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _Group {
  const _Group(this.title, this.rows);
  final String title;
  final List<RowData> rows;
}

class _SearchScreenState extends State<SearchScreen> {
  final ctl = TextEditingController();
  Timer? _wait;
  int _ask = 0;
  String q = '';
  List<_Group>? groups;
  bool busy = false;
  List<Json>? _orders; // every open order, fetched once and searched here

  @override
  void dispose() {
    _wait?.cancel();
    ctl.dispose();
    super.dispose();
  }

  void _changed(String v) {
    _wait?.cancel();
    _wait = Timer(const Duration(milliseconds: 300), () => _search(v.trim()));
  }

  Future<void> _search(String v) async {
    final ask = ++_ask;
    setState(() {
      q = v;
      if (v.length < 2) groups = null;
    });
    if (v.length < 2) return;
    setState(() => busy = true);
    final api = context.api;
    final can = context.can;
    Future<List<Json>> rows(String path) async {
      try {
        return (await api.get(path, query: {'q': v, 'pageSize': 8})).list('rows', (m) => m);
      } on ApiException {
        return const [];
      }
    }

    try {
      _orders ??= await api.getList('/api/orders').catchError((_) => <Json>[]);
    } on ApiException {
      _orders = const [];
    }
    final words = v.toLowerCase().split(RegExp(r'\s+'));
    bool hit(List<String?> parts) {
      final text = parts.whereType<String>().join(' ').toLowerCase();
      return words.every(text.contains);
    }

    final r = await Future.wait([
      rows('/api/customers'),
      rows('/api/inquiries'),
      if (can('sourcing.manage')) rows('/api/factories') else Future.value(<Json>[]),
    ]);
    if (!mounted || ask != _ask) return;
    final orders = _orders!
        .where((o) => hit([o.strOrNull('refNo'), o.at('customer.name'), o.at('inquiry.title'), o.strOrNull('blNo')]))
        .take(8);
    setState(() {
      busy = false;
      groups = [
        _Group('Orders', [
          for (final o in orders)
            RowData(
              title: o.str('refNo'),
              sub: [o.at('customer.name'), o.at('inquiry.title')],
              badge: OrderStageEnum.badge(o.strOrNull('stage')),
              onTap: () => _go('/orders/${o.str('id')}'),
            ),
        ]),
        _Group('Customers', [
          for (final c in r[0])
            RowData(
              title: c.str('name'),
              sub: [countryName(c.strOrNull('country')), c.at('primaryContact.name')],
              onTap: () => _go('/customers/${c.str('id')}'),
            ),
        ]),
        _Group('Inquiries', [
          for (final i in r[1])
            RowData(
              title: i.str('title'),
              sub: [i.strOrNull('refNo'), i.at('customer.name')],
              badge: InquiryStageEnum.badge(i.strOrNull('stage')),
              onTap: () => _go('/inquiries/${i.str('id')}'),
            ),
        ]),
        _Group('Factories', [
          for (final f in r[2])
            RowData(title: f.str('name'), sub: [f.strOrNull('contactPerson'), f.strOrNull('phone')], onTap: () => _go('/factories/${f.str('id')}')),
        ]),
      ].where((g) => g.rows.isNotEmpty).toList();
    });
  }

  void _go(String path) {
    _recent
      ..remove(q)
      ..insert(0, q);
    if (_recent.length > 6) _recent.removeLast();
    openLink(context, path);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final g = groups;
    final found = g?.fold<int>(0, (n, x) => n + x.rows.length) ?? 0;
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Padding(
          padding: const EdgeInsets.only(right: Gap.lg),
          child: TextField(
            controller: ctl,
            autofocus: true,
            onChanged: _changed,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Order, customer, inquiry, B/L…',
              prefixIcon: Icon(Icons.search, color: c.muted),
              suffixIcon: q.isEmpty
                  ? null
                  : IconButton(icon: const Icon(Icons.close), tooltip: 'Clear', onPressed: () {
                      ctl.clear();
                      _search('');
                    }),
            ),
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(Gap.lg, Gap.sm, Gap.lg, Gap.xl),
        children: [
          if (busy) const Padding(padding: EdgeInsets.all(Gap.md), child: LinearProgressIndicator()),
          Semantics(
            liveRegion: true,
            child: q.length >= 2 && g != null
                ? Padding(
                    padding: const EdgeInsets.only(bottom: Gap.sm),
                    child: Text(found == 0 ? 'Nothing found for "$q"' : count(found, '1 result', '{} results') ?? '',
                        style: context.text.bodySmall?.copyWith(color: c.text2)),
                  )
                : const SizedBox.shrink(),
          ),
          if (g != null)
            for (final x in g) ...[
              SectionCard(
                title: x.title,
                count: x.rows.length,
                child: Column(children: [for (final (i, r) in x.rows.indexed) PhoneRow(r, divider: i < x.rows.length - 1)]),
              ),
              const SizedBox(height: Gap.md),
            ]
          else if (_recent.isNotEmpty)
            SectionCard(
              title: 'Recent',
              child: Column(children: [
                for (final (i, r) in _recent.indexed)
                  PhoneRow(
                    RowData(title: r, onTap: () {
                      ctl.text = r;
                      _search(r);
                    }, trailing: Icon(Icons.history, color: c.muted, size: 20)),
                    divider: i < _recent.length - 1,
                  ),
              ]),
            )
          else
            const EmptyState(title: 'Search everything', text: 'Type at least 2 letters: an order or inquiry number, a customer, a product, a B/L.'),
        ],
      ),
    );
  }
}
