import 'package:flutter/material.dart';

import '../core/json.dart';
import 'kit.dart';

/// A list that loads page by page from an endpoint returning { rows, total, page, pageSize }.
/// Pull to refresh; the next page loads as you reach the end. Give it a new key to reload
/// when filters change.
class PagedList extends StatefulWidget {
  const PagedList({
    super.key,
    required this.load,
    required this.itemBuilder,
    this.header = const [],
    this.empty,
    this.rowsKey = 'rows',
    this.onLoaded,
  });

  final Future<Json> Function(int page) load;
  final Widget Function(BuildContext, Json) itemBuilder;
  final List<Widget> header;
  final Widget? empty;
  final String rowsKey;
  final void Function(Json first)? onLoaded;

  @override
  State<PagedList> createState() => _PagedListState();
}

class _PagedListState extends State<PagedList> {
  final _rows = <Json>[];
  int _page = 0;
  int _total = 0;
  bool _loading = false;
  Object? _error;

  bool get _hasMore => _rows.length < _total;

  @override
  void initState() {
    super.initState();
    _next(reset: true);
  }

  Future<void> _next({bool reset = false}) async {
    if (_loading) return;
    setState(() {
      _loading = true;
      if (reset) _error = null;
    });
    try {
      final page = reset ? 1 : _page + 1;
      final res = await widget.load(page);
      if (!mounted) return;
      setState(() {
        if (reset) _rows.clear();
        _rows.addAll(res.l(widget.rowsKey));
        _page = page;
        _total = res.i('total', _rows.length);
        _error = null;
      });
      if (page == 1) widget.onLoaded?.call(res);
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () => _next(reset: true),
      child: NotificationListener<ScrollNotification>(
        onNotification: (n) {
          if (n.metrics.pixels > n.metrics.maxScrollExtent - 400 && _hasMore && !_loading && _error == null) _next();
          return false;
        },
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            for (final h in widget.header) SliverToBoxAdapter(child: h),
            if (_error != null && _rows.isEmpty)
              SliverFillRemaining(hasScrollBody: false, child: ErrorState(_error!, onRetry: () => _next(reset: true)))
            else if (_rows.isEmpty && _loading)
              const SliverFillRemaining(hasScrollBody: false, child: LoadingView())
            else if (_rows.isEmpty)
              SliverFillRemaining(hasScrollBody: false, child: widget.empty ?? const EmptyState(icon: Icons.inbox_outlined, title: 'Nothing here yet'))
            else ...[
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
                sliver: SliverToBoxAdapter(child: Text('$_total ${_total == 1 ? 'result' : 'results'}', style: context.t.bodySmall)),
              ),
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                sliver: SliverToBoxAdapter(
                  child: Card(
                    clipBehavior: Clip.antiAlias,
                    child: CardList(children: [for (final r in _rows) widget.itemBuilder(context, r)]),
                  ),
                ),
              ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
                  child: _loading
                      ? const Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2)))
                      : _error != null
                          ? TextButton(onPressed: _next, child: const Text('Could not load more — try again'))
                          : const SizedBox(),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
