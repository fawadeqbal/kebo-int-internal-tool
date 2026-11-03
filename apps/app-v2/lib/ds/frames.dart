import 'dart:async';

import 'package:flutter/material.dart' hide Badge;
import 'package:go_router/go_router.dart';

import '../core/api.dart';
import '../core/json.dart';
import '../core/scope.dart';
import 'fields.dart';
import 'form_sheet.dart';
import 'format.dart';
import 'theme.dart';
import 'tone.dart';
import 'widgets.dart';

// ---------------------------------------------------------------- list

/// The "New …" button of a list. Hidden when the person may not add.
class AddAction {
  const AddAction({required this.label, required this.open, this.perm});
  final String label;
  final String? perm;
  final Future<bool> Function(BuildContext context) open;
}

/// A chip above a list: what it asks the API for, and which counts make its number.
class ListFilter {
  const ListFilter(this.label, {this.query = const {}, this.count = const []});
  final String label;
  final Map<String, String> query;
  final List<String> count;
}

/// Every list: a search box, rows that open on tap, pages loaded as you scroll,
/// pull to refresh, and one "New" button.
class ListFrame<T> extends StatefulWidget {
  const ListFrame({
    super.key,
    required this.title,
    required this.load,
    required this.row,
    this.onOpen,
    this.onDecide,
    this.searchHint,
    this.add,
    this.localSearch = false,
    this.filters = const [],
  });

  final String title;
  final String? searchHint;
  final Future<Paged<T>> Function(Api api, String? q, int page, Map<String, String> query) load;
  final RowData Function(T x) row;
  final void Function(BuildContext context, T x)? onOpen;

  /// Instead of [onOpen]: a row decided in a sheet; the list reloads when it says true.
  final Future<bool> Function(BuildContext context, T x)? onDecide;
  final AddAction? add;

  /// The API sends every row at once: search them on the phone.
  final bool localSearch;

  /// Chips above the list; the first is chosen at the start.
  final List<ListFilter> filters;

  @override
  State<ListFrame<T>> createState() => _ListFrameState<T>();
}

class _ListFrameState<T> extends State<ListFrame<T>> {
  final rows = <T>[];
  int total = 0, page = 0;
  bool loading = false, more = true;
  String? error, q;
  Timer? _debounce;
  int filter = 0;
  Map<String, int> counts = const {};
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
      final query = widget.filters.isEmpty ? const <String, String>{} : widget.filters[filter].query;
      final p = await widget.load(context.api, widget.localSearch ? null : q, page + 1, query);
      if (!mounted || ask != _ask) return;
      setState(() {
        rows.addAll(widget.localSearch && q != null ? p.rows.where(_matches) : p.rows);
        total = widget.localSearch ? rows.length : p.total;
        if (p.counts.isNotEmpty) counts = p.counts;
        page = p.page == 0 ? page + 1 : p.page;
        more = p.hasMore;
      });
    } on ApiException catch (e) {
      if (mounted && ask == _ask) setState(() => error = e.message);
    } finally {
      if (mounted && ask == _ask) setState(() => loading = false);
    }
  }

  bool _matches(T x) {
    final d = widget.row(x);
    final words = q!.toLowerCase().split(RegExp(r'\s+'));
    final text = joinParts([d.title, ...d.sub, d.value, d.badge?.label]).toLowerCase();
    return words.every(text.contains);
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

  String _chip(ListFilter f) {
    if (f.count.isEmpty || counts.isEmpty) return f.label;
    return '${f.label} ${f.count.fold<int>(0, (n, k) => n + (counts[k] ?? 0))}';
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
      body = ListView(
        children: [
          EmptyState(
            title: q == null ? 'Nothing here yet' : 'No match for "$q"',
            text: q == null ? null : 'Try fewer letters, or a phone number or email.',
            action: add != null && q == null ? FilledButton(onPressed: _add, child: Text(add.label)) : null,
          ),
        ],
      );
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
                      : Text(
                          count(total, '{} in all', '{} in all') ?? '',
                          style: ctx.text.bodySmall?.copyWith(color: c.muted),
                        ),
                ),
              );
            }
            final x = rows[i];
            final d = widget.row(x);
            return PhoneRow(
              RowData(
                title: d.title,
                sub: d.sub,
                badge: d.badge,
                value: d.value,
                actions: d.actions,
                onTap: widget.onDecide != null
                    ? () async {
                        if (await widget.onDecide!(ctx, x) && mounted) _reload();
                      }
                    : widget.onOpen == null
                        ? null
                        : () => widget.onOpen!(ctx, x),
              ),
            );
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
              child: FilledButton.icon(
                onPressed: _add,
                icon: const Icon(Icons.add, size: 18),
                label: const Text('New'),
              ),
            ),
        ],
      ),
      body: Column(
        children: [
          if (widget.searchHint != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(Gap.lg, Gap.xs, Gap.lg, Gap.sm),
              child: SearchField(hint: widget.searchHint!, onChanged: _search),
            ),
          if (widget.filters.isNotEmpty)
            SizedBox(
              height: Gap.tap,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: Gap.lg),
                children: [
                  for (final (i, f) in widget.filters.indexed)
                    Padding(
                      padding: const EdgeInsets.only(right: Gap.sm),
                      child: Center(
                        child: ChoiceChip(
                          label: Text(_chip(f)),
                          selected: i == filter,
                          onSelected: (_) {
                            setState(() => filter = i);
                            _ask++;
                            loading = false;
                            _reload();
                          },
                        ),
                      ),
                    ),
                ],
              ),
            ),
          if (error != null && rows.isNotEmpty)
            Padding(padding: const EdgeInsets.all(Gap.lg), child: MessageBanner(error!)),
          Expanded(
            child: RefreshIndicator(onRefresh: _reload, child: body),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------- record

/// A button on a record. [run] returns true when the record changed (it reloads).
class RecordAction<T> {
  const RecordAction({required this.label, required this.run, this.perm, this.visible, this.danger = false})
    : confirm = null,
      delete = null;

  /// Asks [confirm], deletes, goes back, says so.
  const RecordAction.delete({
    required this.label,
    required this.confirm,
    required Future<void> Function(Api api, T x) run,
    this.perm,
    this.visible,
  }) : delete = run,
       run = null,
       danger = true;

  final String label;

  /// Shown only when this says so (e.g. "Resume" only when on hold).
  final bool Function(T x)? visible;

  /// Red in the menu: it ends or removes something.
  final bool danger;
  final String? perm, confirm;
  final Future<bool> Function(BuildContext context, T x)? run;
  final Future<void> Function(Api api, T x)? delete;
}

/// A pill that jumps to a section: a button for screen readers, 48 high for fingers.
class JumpChip extends StatelessWidget {
  const JumpChip({super.key, required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Semantics(
      button: true,
      label: 'Go to $label',
      excludeSemantics: true,
      onTap: onTap,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          constraints: const BoxConstraints(minHeight: Gap.tap),
          alignment: Alignment.center,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
            decoration: BoxDecoration(
              color: c.surface,
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: c.line),
            ),
            child: Text(label, style: context.text.labelMedium),
          ),
        ),
      ),
    );
  }
}

/// Lets a hand-written section reload the record it sits on (after it changed something).
class RecordScope extends InheritedWidget {
  const RecordScope({super.key, required this.reload, required super.child});
  final Future<void> Function() reload;

  static Future<void> reloadOf(BuildContext context) =>
      context.getInheritedWidgetOfExactType<RecordScope>()?.reload() ?? Future.value();

  @override
  bool updateShouldNotify(RecordScope old) => false;
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

/// A section written by hand (lib/custom), e.g. an order's papers. [child] draws its own card.
class CustomSection extends SectionDef {
  const CustomSection(super.title, this.child);
  final Widget child;
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
  const RecordFrame({
    super.key,
    required this.load,
    required this.title,
    required this.sections,
    this.sub,
    this.badges,
    this.primary,
    this.more = const [],
  });

  final Future<T> Function(Api api) load;
  final String? Function(T x) title;
  final List<String?> Function(T x)? sub;

  /// Status words under the title: the stage, "On hold", "Late".
  final List<Badge?> Function(T x)? badges;
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
    bool shown(RecordAction<T> a) => context.can(a.perm) && (a.visible?.call(v) ?? true);
    final primary = widget.primary != null && shown(widget.primary!) ? widget.primary : null;
    final more = widget.more.where(shown).toList();
    final badges = widget.badges?.call(v).whereType<Badge>().toList() ?? const <Badge>[];
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
                  PopupMenuItem(
                    value: a,
                    child: Text(a.label, style: TextStyle(color: a.danger ? c.bad : null)),
                  ),
              ],
            ),
        ],
      ),
      body: RecordScope(
        reload: _load,
        child: RefreshIndicator(
          onRefresh: _load,
          // Every section is built at once (a record has a handful), so the chips can jump to any of them.
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(Gap.lg, 0, Gap.lg, Gap.xl),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Semantics(header: true, child: Text(widget.title(v) ?? '', style: context.text.titleLarge)),
                if (sub.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(sub, style: context.text.bodySmall?.copyWith(color: c.text2)),
                ],
                if (badges.isNotEmpty) ...[
                  const SizedBox(height: Gap.sm),
                  Wrap(spacing: Gap.sm, runSpacing: Gap.xs, children: [for (final b in badges) StatusBadge(b)]),
                ],
                if (primary != null) ...[
                  const SizedBox(height: Gap.md),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: FilledButton(onPressed: () => _do(primary), child: Text(primary.label)),
                  ),
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
        ),
      ),
    );
  }

  /// The section names as chips: visible, not hidden tabs. A tap scrolls there.
  Widget _jump(BuildContext context, List<SectionDef> sections) => SingleChildScrollView(
    scrollDirection: Axis.horizontal,
    child: Row(
      children: [
        for (final s in sections)
          Padding(
            padding: const EdgeInsets.only(right: Gap.sm),
            child: JumpChip(
              label: s is ListSection && s.rows.isNotEmpty ? '${s.title} ${s.rows.length}' : s.title,
              onTap: () {
                final ctx = keys[s.title]?.currentContext;
                if (ctx != null) {
                  Scrollable.ensureVisible(ctx, duration: const Duration(milliseconds: 250), alignment: 0.02);
                }
              },
            ),
          ),
      ],
    ),
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
      case CustomSection(:final child):
        return child;
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

/// An action described in the spec: asks [fields] (if any), then posts [send] + the
/// answers to [path]. True when it was done (the record reloads).
Future<bool> postAction(
  BuildContext context, {
  required String title,
  required String path,
  Map<String, Object?> send = const {},
  List<FieldDef> fields = const [],
  bool danger = false,
}) async {
  if (fields.isEmpty) {
    Object? reason;
    while (true) {
      try {
        await context.api.post(path, {...send, 'reason': ?reason});
        return true;
      } on ApiException catch (e) {
        if (!context.mounted) return false;
        if (e.code == 'reason_needed' && reason == null) {
          reason = await askReason(context, e);
          if (reason != null && context.mounted) continue;
          return false;
        }
        toast(context, e.message);
        return false;
      }
    }
  }
  return FormSheet.open(
    context,
    title: title,
    save: title.replaceAll('…', ''),
    groups: [FormGroup(fields: fields)],
    initial: {
      for (final f in fields)
        if (f.defaultValue != null) f.key: f.defaultValue,
    },
    send: (api, body) => api.post(path, {...send, ...body}),
    danger: danger,
  );
}
