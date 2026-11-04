import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import 'files.dart';
import 'keep.dart';

import 'json.dart';

/// The server's error: always `{ message | error, code?, fieldErrors?, ... }`.
class ApiException implements Exception {
  ApiException(this.message, {this.status = 0, this.code, this.fieldErrors = const {}, this.data = const {}});

  final String message;
  final int status;
  final String? code;
  final Map<String, String> fieldErrors;
  final Json data;

  bool get unauthorized => status == 401;
  bool get offline => status == 0;

  /// 409 "duplicate": `matches: [{ id, label, detail }]`.
  List<Json> get matches => data.list('matches', (m) => m);

  @override
  String toString() => message;
}

/// Whether the server can be reached. Goes offline when a call gets no answer; while offline it asks
/// /api/health now and then, and says when it is back.
class NetState extends ChangeNotifier {
  bool offline = false;

  /// While offline: when the oldest answer shown was kept ("Offline · as of 9:41").
  DateTime? asOf;

  /// Back online: send what waits, read again what is kept.
  void Function()? onBack;

  /// Asks the server whether it is there (set by [Api]).
  Future<bool> Function()? probe;
  Duration probeEvery = const Duration(seconds: 15);
  Timer? _timer;

  void lost() {
    if (offline) return;
    offline = true;
    notifyListeners();
    _schedule();
  }

  void reached() {
    if (!offline) return;
    offline = false;
    asOf = null;
    _timer?.cancel();
    notifyListeners();
    onBack?.call();
  }

  void servedFromCache(DateTime at) {
    if (asOf != null && !at.isBefore(asOf!)) return;
    asOf = at;
    notifyListeners();
  }

  /// Asks now (pull to refresh, the app coming back to the front).
  Future<bool> check() async {
    final ok = await (probe?.call() ?? Future.value(true));
    ok ? reached() : lost();
    return ok;
  }

  void _schedule() {
    _timer?.cancel();
    _timer = Timer(probeEvery, () async {
      if (!offline) return;
      if (await (probe?.call() ?? Future.value(false))) {
        reached();
      } else {
        _schedule();
      }
    });
  }

  /// No more asking (tests, signing out).
  void stop() => _timer?.cancel();
}

/// "This order isn't on the phone…": what to say when a page was never opened while online.
String notKeptMessage(String path) {
  final kind = RegExp(r'^/api/(orders|inquiries|customers|factories)/').firstMatch(path)?.group(1);
  final what = switch (kind) { 'orders' => 'This order', 'inquiries' => 'This inquiry', 'customers' => 'This customer', 'factories' => 'This factory', _ => 'This' };
  return "$what isn't on the phone. Open it once while online.";
}

/// Talks to `<server>/api/...` with the bearer token.
class Api {
  Api({required String server, Dio? dio}) : _dio = dio ?? Dio() {
    this.server = server;
    _dio.options
      ..connectTimeout = const Duration(seconds: 15)
      ..receiveTimeout = const Duration(seconds: 60)
      ..headers['Accept'] = 'application/json';
    _dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
      if (token != null) o.headers['Authorization'] = 'Bearer $token';
      h.next(o);
    }));
    net.probe = () async {
      try {
        await _dio.get<Object?>('/api/health', options: Options(receiveTimeout: const Duration(seconds: 8), sendTimeout: const Duration(seconds: 8)));
        return true;
      } on DioException catch (e) {
        return e.response != null; // any answer means the server is there
      }
    };
  }

  /// Online or not; see [NetState].
  final NetState net = NetState();

  /// Answers kept for when there is no signal; none in tests unless set.
  ReadCache? cache;

  final Dio _dio;
  String? token;

  /// Called on any 401, so the app can go back to sign-in.
  void Function()? onSignedOut;

  String get server => _dio.options.baseUrl;

  /// A trailing "/" or "/api" typed by someone is dropped: every path starts with /api/.
  set server(String v) => _dio.options.baseUrl = v.trim().replaceAll(RegExp(r'/+$'), '').replaceAll(RegExp(r'/api$'), '');

  Future<Json> get(String path, {Map<String, Object?>? query}) async {
    final data = await _read(path, query);
    return data is Map<String, dynamic> ? data : <String, dynamic>{};
  }

  /// A list endpoint: a plain list, or the `rows` of a page.
  Future<List<Json>> getList(String path, {Map<String, Object?>? query}) async {
    var data = await _read(path, query);
    if (data is Map<String, dynamic> && data['rows'] is List) data = data['rows'];
    return data is List ? [for (final e in data) if (e is Map<String, dynamic>) e] : const [];
  }

  Future<Json> post(String path, [Object? body]) => _map(() => _dio.post<Object?>(path, data: body ?? const <String, Object?>{}));
  Future<Json> put(String path, Object body) => _map(() => _dio.put<Object?>(path, data: body));
  Future<Json> patch(String path, Object body) => _map(() => _dio.patch<Object?>(path, data: body));
  Future<void> delete(String path) => _send(() => _dio.delete<Object?>(path));

  /// A file with its name from Content-Disposition; [progress] goes 0 → 1 when the size is known.
  Future<Downloaded> download(String path, {void Function(double)? progress}) async {
    try {
      final res = await _dio.get<List<int>>(
        path,
        options: Options(responseType: ResponseType.bytes, receiveTimeout: const Duration(minutes: 3)),
        onReceiveProgress: progress == null ? null : (got, total) => total > 0 ? progress(got / total) : null,
      );
      return Downloaded(
        Uint8List.fromList(res.data ?? const []),
        fileName: fileNameFrom(res.headers.value('content-disposition')),
        type: res.headers.value('content-type')?.split(';').first.trim(),
      );
    } on DioException catch (e) {
      // The error body came as bytes: read it as the usual JSON.
      final data = e.response?.data;
      if (data is List<int>) {
        Object? body;
        try {
          body = jsonDecode(utf8.decode(data));
        } catch (_) {
          body = {'error': utf8.decode(data, allowMalformed: true).trim()};
        }
        throw _error(DioException(requestOptions: e.requestOptions, response: Response(requestOptions: e.requestOptions, statusCode: e.response?.statusCode, data: body)));
      }
      throw _error(e);
    }
  }

  /// multipart/form-data: one `file` and the text [fields]. [progress] goes 0 → 1.
  Future<Json> upload(String path, {required Uint8List bytes, required String fileName, Map<String, String?> fields = const {}, void Function(double)? progress}) =>
      _map(() => _dio.post<Object?>(
            path,
            data: FormData.fromMap({
              for (final e in fields.entries) if (e.value != null && e.value!.isNotEmpty) e.key: e.value,
              'file': MultipartFile.fromBytes(bytes, filename: fileName),
            }),
            options: Options(sendTimeout: const Duration(minutes: 5), receiveTimeout: const Duration(minutes: 2)),
            onSendProgress: progress == null ? null : (sent, total) => total > 0 ? progress(sent / total) : null,
          ));

  /// A GET: from the server (and kept), else the kept answer while there is no signal.
  Future<Object?> _read(String path, Map<String, Object?>? query) async {
    final q = _clean(query);
    final url = Uri(path: path, queryParameters: q == null || q.isEmpty ? null : {for (final e in q.entries) e.key: '${e.value}'}).toString();
    final c = cache?..owner = '$server|$token';
    if (c != null && net.offline) {
      // Known to be offline: the kept copy at once, no waiting for a timeout.
      final k = await c.get(url);
      if (k != null) {
        net.servedFromCache(k.at);
        return k.data;
      }
    }
    try {
      final data = await _send(() => _dio.get<Object?>(path, queryParameters: q));
      if (c != null) unawaited(c.put(url, data).catchError((_) {}));
      return data;
    } on ApiException catch (e) {
      if (!e.offline || c == null) rethrow;
      final k = await c.get(url);
      if (k == null) throw ApiException(notKeptMessage(path), code: 'not_kept');
      net.servedFromCache(k.at);
      return k.data;
    }
  }

  static Map<String, Object?>? _clean(Map<String, Object?>? q) =>
      q == null ? null : {for (final e in q.entries) if (e.value != null && e.value != '') e.key: e.value};

  Future<Json> _map(Future<Response<Object?>> Function() call) async {
    final data = await _send(call);
    return data is Map<String, dynamic> ? data : <String, dynamic>{};
  }

  Future<Object?> _send(Future<Response<Object?>> Function() call) async {
    try {
      final data = (await call()).data;
      net.reached();
      return data;
    } on DioException catch (e) {
      throw _error(e);
    }
  }

  ApiException _error(DioException e) {
    final res = e.response;
    if (res == null) {
      net.lost();
      return ApiException('No connection to the server. Check the internet and try again.');
    }
    net.reached();
    final body = res.data is Map<String, dynamic> ? res.data as Json : <String, dynamic>{};
    final status = res.statusCode ?? 0;
    if (status == 401 && token != null) onSignedOut?.call();
    final fields = <String, String>{};
    final fe = body['fieldErrors'];
    if (fe is Map) {
      for (final MapEntry(:key, :value) in fe.entries) {
        final msg = value is List && value.isNotEmpty ? '${value.first}' : '$value';
        fields['$key'] = msg;
      }
    }
    final message = body.strOrNull('message') ?? body.strOrNull('error') ?? switch (status) {
      403 => 'You do not have permission to do this.',
      404 => 'This was not found. It may have been deleted.',
      _ => 'Something went wrong on the server ($status). Try again.',
    };
    return ApiException(message, status: status, code: body.strOrNull('code'), fieldErrors: fields, data: body);
  }
}
