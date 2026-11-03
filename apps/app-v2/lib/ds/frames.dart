import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../core/api.dart';
import '../core/json.dart';
import '../core/scope.dart';
import 'format.dart';
import 'theme.dart';
import 'widgets.dart';

// ---------------------------------------------------------------- list

/// The "New …" button of a list. Hidden when the person may not add.
class AddAction {
  const AddAction({required this.label, required this.open, this.perm});
  final String label;
  final String? perm;
  final Future<bool> Function(BuildContext context) open;
}

/// Every list: a search box, rows that open on tap, pages loaded as you scroll,
/// pull to refresh, and one "New" button.
class ListFrame<T> extends StatefulWidget {
  const ListFrame({super.key, required this.title, required this.load, required this.row, this.onOpen, this.searchHint, this.add});

  final String title;
  final String? searchHint;
  final Future<Paged<T>> Function(Api api, String? q, int page) load;
  final RowData Function(T x) row;
  final void Function(BuildContext context, T x)? onOpen;
  final AddAction? add;

  @override
  State<ListFrame<T>> createState() => _ListFrameState<T>();
}

class _ListFrameState<T> extends State<ListFrame<T>> {
  final rows = <T>[];
  int total = 0, page = 0;
  bool loading = false, more = true;
  String? error, q;
  Timer? _debounce;
  int _ask = 0;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (page == 0 && !loading) _reload();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _reload() async {
    rows.clear();
    page = 0;
    more = true;
    await _next();
  }

  Future<void> _next() async {
    if (loading || !more) return;
    final ask = ++_ask;
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final p = await widget.load(context.api, q, page + 1);
      if (!mounted || ask != _ask) return;
      setState(() {
        rows.addAll(p.rows);
        total = p.total;
        page = p.page == 0 ? page + 1 : p.page;
        more = p.hasMore;
      });
    } on ApiException catch (e) {
      if (mounted && ask == _ask) setState(() => error = e.message);
    } finally {
      if (mounted && ask == _ask) setState(() => loading = false);
    }
  }

  void _search(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      q = v.trim().isEmpty ? null : v.trim();
      _ask++;
      loading = false;
      _reload();
    });
  }

  Future<void> _add() async {
    if (await widget.add!.open(context) && mounted) {
      toast(context, 'Saved');
      _reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final add = widget.add != null && context.can(widget.add!.perm) ? widget.add : null;
    final Widget body;
    if (error != null && rows.isEmpty) {
      body = ErrorView(error!, retry: _reload);
    } else if (rows.isEmpty && loading) {
      body = const LoadingView();
    } else if (rows.isEmpty) {
      body = ListView(children: [
        EmptyState(
          title: q == null ? 'Nothing here yet' : 'No match for "$q"',
          text: q == null ? null : 'Try fewer letters, or a phone number or email.',
          action: add != null && q == null ? FilledButton(onPressed: _add, child: Text(add.label)) : null,
        ),
      ]);
    } else {
      body = NotificationListener<ScrollNotification>(
        onNotification: (n) {
          if (n.metrics.extentAfter < 400) _next();
          return false;
        },
        child: ListView.builder(
          padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, 96),
          itemCount: rows.length + 1,
          itemBuilder: (ctx, i) {
            if (i == rows.length) {
              return Padding(
                padding: const EdgeInsets.all(Gap.lg),
                child: Center(
                  child: loading
                      ? const LoadingView()
                      : Text(count(total, '{} in all', '{} in all') ?? '', style: ctx.text.bodySmall?.copyWith(color: c.muted)),
                ),
              );
            }
            final x = rows[i];
            final d = widget.row(x);
            return PhoneRow(RowData(
              title: d.title,
              sub: d.sub,
              badge: d.badge,
              value: d.value,
              actions: d.actions,
              onTap: widget.onOpen == null ? null : () => widget.onOpen!(ctx, x),
            ));
          },
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(
        title: Semantics(header: true, child: Text(widget.title)),
        actions: [
          if (add != null)
            Padding(
              padding: const EdgeInsets.only(right: Gap.md),
              child: FilledButton.icon(onPressed: _add, icon: const Icon(Icons.add, size: 18), label: const Text('New')),
            ),
        ],
      ),
      body: Column(children: [
        if (widget.searchHint != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(Gap.lg, Gap.xs, Gap.lg, Gap.sm),
            child: SearchField(hint: widget.searchHint!, onChanged: _search),
          ),
        if (error != null && rows.isNotEmpty) Padding(padding: const EdgeInsets.all(Gap.lg), child: MessageBanner(error!)),
        Expanded(child: RefreshIndicator(onRefresh: _reload, child: body)),
      ]),
    );
  }
}

// ---------------------------------------------------------------- record

/// A button on a record. [run] returns true when the record changed (it reloads).
class RecordAction<T> {
  const RecordAction({required this.label, required this.run, this.perm}) : confirm = null, delete = null;

  /// Asks [confirm], deletes, goes back, says so.
  const RecordAction.delete({required this.label, required this.confirm, required Future<void> Function(Api api, T x) run, this.perm})
      : delete = run,
        run = null;

  final String label;
  final String? perm, confirm;
  final Future<bool> Function(BuildContext context, T x)? run;
  final Future<void> Function(Api api, T x)? delete;
}

sealed class SectionDef {
  const SectionDef(this.title);
  final String title;
}

/// Label–value pairs; empty values are left out.
class KvSection extends SectionDef {
  const KvSection(super.title, this.pairs);
  final List<(String, String?)> pairs;
}

/// A list of rows inside a card.
class ListSection extends SectionDef {
  const ListSection(super.title, this.rows, {this.empty});
  final List<RowData> rows;
  final String? empty;
}

/// Every record: title and details, one primary button, ⋯ for the rest, and
/// sections in a fixed order. The section names at the top jump to each one.
class RecordFrame<T> extends StatefulWidget {
  const RecordFrame({super.key, required this.load, required this.title, required this.sections, this.sub, this.primary, this.more = const []});

  final Future<T> Function(Api api) load;
  final String? Function(T x) title;
  final List<String?> Function(T x)? sub;
  final RecordAction<T>? primary;
  final List<RecordAction<T>> more;
  final List<SectionDef> Function(T x) sections;

  @override
  State<RecordFrame<T>> createState() => _RecordFrameState<T>();
}

class _RecordFrameState<T> extends State<RecordFrame<T>> {
  T? x;
  String? error;
  bool loading = false;
  final keys = <String, GlobalKey>{};

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (x == null && !loading && error == null) _load();
  }

  Future<void> _load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final v = await widget.load(context.api);
      if (mounted) setState(() => x = v);
    } on ApiException catch (e) {
      if (mounted) setState(() => error = e.message);
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> _do(RecordAction<T> a) async {
    final v = x as T;
    if (a.delete != null) {
      final ok = await confirmDialog(context, title: a.label, text: a.confirm, yes: 'Delete', danger: true);
      if (!ok || !mounted) return;
      try {
        await a.delete!(context.api, v);
        if (!mounted) return;
        toast(context, 'Deleted');
        context.canPop() ? context.pop() : null;
      } on ApiException catch (e) {
        if (mounted) toast(context, e.message);
      }
      return;
    }
    if (await a.run!(context, v) && mounted) {
      toast(context, 'Saved');
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final v = x;
    if (v == null) {
      return Scaffold(
        appBar: AppBar(),
        body: error != null ? ErrorView(error!, retry: _load) : const LoadingView(),
      );
    }
    final sections = widget.sections(v);
    final primary = widget.primary != null && context.can(widget.primary!.perm) ? widget.primary : null;
    final more = widget.more.where((a) => context.can(a.perm)).toList();
    final sub = joinParts(widget.sub?.call(v) ?? const []);
    return Scaffold(
      appBar: AppBar(
        actions: [
          if (more.isNotEmpty)
            PopupMenuButton<RecordAction<T>>(
              tooltip: 'More actions',
              icon: const Icon(Icons.more_horiz),
              onSelected: _do,
              itemBuilder: (_) => [
                for (final a in more)
                  PopupMenuItem(value: a, child: Text(a.label, style: TextStyle(color: a.delete != null ? c.bad : null))),
              ],
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.xl),
          children: [
            Semantics(header: true, child: Text(widget.title(v) ?? '', style: context.text.titleLarge)),
            if (sub.isNotEmpty) ...[
              const SizedBox(height: 2),
              Text(sub, style: context.text.bodySmall?.copyWith(color: c.text2)),
            ],
            if (primary != null) ...[
              const SizedBox(height: Gap.md),
              Align(alignment: Alignment.centerLeft, child: FilledButton(onPressed: () => _do(primary), child: Text(primary.label))),
            ],
            const SizedBox(height: Gap.md),
            _jump(context, sections),
            for (final s in sections) ...[
              const SizedBox(height: Gap.md),
              KeyedSubtree(
                key: keys.putIfAbsent(s.title, GlobalKey.new),
                child: KeyedSubtree(key: ValueKey('section:${s.title}'), child: _section(context, s)),
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// The section names as chips: visible, not hidden tabs. A tap scrolls there.
  Widget _jump(BuildContext context, List<SectionDef> sections) => SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: [
          for (final s in sections)
            Padding(
              padding: const EdgeInsets.only(right: Gap.sm),
              child: ActionChip(
                label: Text(s is ListSection && s.rows.isNotEmpty ? '${s.title} ${s.rows.length}' : s.title),
                onPressed: () {
                  final ctx = keys[s.title]?.currentContext;
                  if (ctx != null) Scrollable.ensureVisible(ctx, duration: const Duration(milliseconds: 250), alignment: 0.02);
                },
              ),
            ),
        ]),
      );

  Widget _section(BuildContext context, SectionDef s) {
    final c = context.colors;
    switch (s) {
      case KvSection(:final pairs):
        final shown = pairs.where((p) => p.$2 != null && p.$2!.trim().isNotEmpty).toList();
        return SectionCard(
          title: s.title,
          child: shown.isEmpty
              ? Padding(
                  padding: const EdgeInsets.symmetric(vertical: Gap.md),
                  child: Text('Nothing added yet', style: context.text.bodySmall?.copyWith(color: c.muted)),
                )
              : Column(children: [for (final p in shown) KvRow(p.$1, p.$2!)]),
        );
      case ListSection(:final rows, :final empty):
        return SectionCard(
          title: s.title,
          count: rows.isEmpty ? null : rows.length,
          child: rows.isEmpty
              ? Padding(
                  padding: const EdgeInsets.symmetric(vertical: Gap.md),
                  child: Text(empty ?? 'None yet', style: context.text.bodySmall?.copyWith(color: c.muted)),
                )
              : Column(children: [for (final (i, r) in rows.indexed) PhoneRow(r, divider: i < rows.length - 1)]),
        );
    }
  }
}
