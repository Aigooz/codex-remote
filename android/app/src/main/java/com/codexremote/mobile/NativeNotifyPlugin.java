package com.codexremote.mobile;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.PackageInfo;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import androidx.activity.result.ActivityResult;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipFile;

@CapacitorPlugin(name = "NativeNotify", permissions = {@Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})})
public class NativeNotifyPlugin extends Plugin {
    private static final String CHANNEL_ID = "codex_remote_status";
    private final ExecutorService updateExecutor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationPermissionResult");
            return;
        }
        call.resolve();
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            call.reject("通知权限未授予");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void show(PluginCall call) {
        String title = call.getString("title", "Codex Remote");
        String body = call.getString("body", "Codex task completed");
        NotificationManager manager = getContext().getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "Codex task status", NotificationManager.IMPORTANCE_DEFAULT));
        if (Build.VERSION.SDK_INT < 33 || ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            manager.notify(1001, new NotificationCompat.Builder(getContext(), CHANNEL_ID).setSmallIcon(getContext().getApplicationInfo().icon).setContentTitle(title).setContentText(body).setStyle(new NotificationCompat.BigTextStyle().bigText(body)).setAutoCancel(true).build());
        }
        call.resolve();
    }

    @PluginMethod
    public void getAppVersion(PluginCall call) {
        try {
            android.content.pm.PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            JSObject result = new JSObject();
            result.put("versionName", info.versionName);
            result.put("versionCode", Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法读取应用版本", error);
        }
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        String source = call.getString("url", "");
        String expectedSha256 = call.getString("sha256", "").trim().toLowerCase(Locale.ROOT);
        long expectedSize = call.getLong("size", 0L);
        Uri sourceUri = Uri.parse(source);
        if (!"https".equalsIgnoreCase(sourceUri.getScheme()) || !"github.com".equalsIgnoreCase(sourceUri.getHost()) || sourceUri.getPath() == null || !sourceUri.getPath().contains("/releases/download/")) {
            call.reject("更新地址必须是 GitHub Release APK");
            return;
        }
        if (!expectedSha256.matches("[a-f0-9]{64}")) {
            call.reject("GitHub 返回的安装包校验信息无效，请稍后重试");
            return;
        }
        if (expectedSize < 1024 || expectedSize > 150L * 1024 * 1024) {
            call.reject("GitHub 返回的安装包大小无效");
            return;
        }
        updateExecutor.execute(() -> downloadUpdate(source, expectedSha256, expectedSize, call));
    }

    private void downloadUpdate(String source, String expectedSha256, long expectedSize, PluginCall call) {
        File apk = null;
        File partial = null;
        Exception lastError = null;
        for (int attempt = 1; attempt <= 3; attempt++) {
            HttpURLConnection connection = null;
            File directory = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            try {
                if (directory == null) throw new IllegalStateException("无法访问应用下载目录");
                if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("无法创建下载目录");
                apk = new File(directory, "codex-remote-update.apk");
                partial = new File(directory, "codex-remote-update.apk.part");
                if (partial.exists() && !partial.delete()) throw new IllegalStateException("无法清理未完成的下载文件");

                connection = (HttpURLConnection) new URL(source).openConnection();
                connection.setConnectTimeout(30000);
                connection.setReadTimeout(60000);
                connection.setInstanceFollowRedirects(true);
                connection.setRequestProperty("Accept", "application/octet-stream");
                connection.setRequestProperty("Accept-Encoding", "identity");
                connection.setRequestProperty("Cache-Control", "no-cache");
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) throw new IllegalStateException("下载失败，HTTP " + status);
                String finalHost = connection.getURL().getHost();
                if (!"https".equalsIgnoreCase(connection.getURL().getProtocol()) || !("github.com".equalsIgnoreCase(finalHost) || finalHost.toLowerCase(Locale.ROOT).endsWith(".githubusercontent.com"))) {
                    throw new IllegalStateException("更新下载被重定向到非 GitHub 地址");
                }
                long contentLength = connection.getContentLengthLong();
                if (contentLength >= 0 && contentLength != expectedSize) throw new IllegalStateException("下载大小与 GitHub 发布信息不一致");

                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long total = 0;
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(partial)) {
                    byte[] buffer = new byte[32768];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        total += count;
                        if (total > expectedSize || total > 150L * 1024 * 1024) throw new IllegalStateException("下载文件超过 GitHub 声明的大小");
                        digest.update(buffer, 0, count);
                        output.write(buffer, 0, count);
                    }
                    output.getFD().sync();
                }

                if (total != expectedSize || partial.length() != expectedSize) throw new IllegalStateException("APK 下载不完整，请检查网络后重试");
                if (!MessageDigest.isEqual(toHex(digest.digest()).getBytes(java.nio.charset.StandardCharsets.US_ASCII), expectedSha256.getBytes(java.nio.charset.StandardCharsets.US_ASCII))) {
                    throw new IllegalStateException("APK 完整性校验失败，已阻止安装，请重新下载");
                }
                validateUpdatePackage(partial);
                if (apk.exists() && !apk.delete()) throw new IllegalStateException("无法替换旧的更新文件");
                if (!partial.renameTo(apk)) throw new IllegalStateException("无法保存已验证的更新文件");
                File downloaded = apk;
                getActivity().runOnUiThread(() -> launchInstaller(downloaded, call));
                return;
            } catch (Exception error) {
                lastError = error;
                if (partial != null && partial.exists()) partial.delete();
                if (connection != null && attempt < 3) {
                    try { Thread.sleep(500L * attempt); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); break; }
                }
            } finally {
                if (connection != null) connection.disconnect();
            }
        }
        String detail = lastError == null ? "下载中断" : lastError.getMessage();
        call.reject("更新未安装：" + (detail == null ? "安装包验证失败" : detail) + "。请检查网络后重新下载。", lastError);
    }

    private String toHex(byte[] value) {
        StringBuilder result = new StringBuilder(value.length * 2);
        for (byte item : value) result.append(String.format(Locale.ROOT, "%02x", item & 0xff));
        return result.toString();
    }

    private void validateUpdatePackage(File apk) throws Exception {
        try (ZipFile archive = new ZipFile(apk)) {
            if (archive.getEntry("AndroidManifest.xml") == null) throw new IllegalStateException("文件不是有效的 Android 安装包");
            java.util.Enumeration<? extends java.util.zip.ZipEntry> entries = archive.entries();
            long expandedSize = 0;
            while (entries.hasMoreElements()) {
                java.util.zip.ZipEntry entry = entries.nextElement();
                try (InputStream input = archive.getInputStream(entry)) {
                    byte[] buffer = new byte[32768];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        expandedSize += count;
                        if (expandedSize > 512L * 1024 * 1024) throw new IllegalStateException("APK 解压内容异常");
                    }
                } catch (Exception error) {
                    if (error instanceof IllegalStateException) throw (IllegalStateException) error;
                    throw new IllegalStateException("APK 压缩数据损坏", error);
                }
            }
        }
        PackageManager manager = getContext().getPackageManager();
        int signingFlag = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo candidate = manager.getPackageArchiveInfo(apk.getAbsolutePath(), signingFlag);
        if (candidate == null || !getContext().getPackageName().equals(candidate.packageName)) {
            throw new IllegalStateException("下载包不是 Codex Remote 安装包");
        }
        PackageInfo installed = manager.getPackageInfo(getContext().getPackageName(), signingFlag);
        Signature[] candidateSignatures = Build.VERSION.SDK_INT >= 28
                ? candidate.signingInfo.getApkContentsSigners() : candidate.signatures;
        Signature[] installedSignatures = Build.VERSION.SDK_INT >= 28
                ? installed.signingInfo.getApkContentsSigners() : installed.signatures;
        if (candidateSignatures == null || installedSignatures == null
                || !Arrays.equals(candidateSignatures, installedSignatures)) {
            throw new IllegalStateException("更新包签名与当前安装不一致，Android 无法覆盖安装");
        }
        long candidateVersion = Build.VERSION.SDK_INT >= 28 ? candidate.getLongVersionCode() : candidate.versionCode;
        long installedVersion = Build.VERSION.SDK_INT >= 28 ? installed.getLongVersionCode() : installed.versionCode;
        if (candidateVersion <= installedVersion) {
            throw new IllegalStateException("下载包版本不高于当前版本");
        }
    }

    private void launchInstaller(File apk, PluginCall call) {
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            startActivityForResult(call, settings, "installPermissionResult");
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".updates", apk);
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(uri, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(install);
            JSObject result = new JSObject();
            result.put("needsPermission", false);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法打开 Android 安装器", error);
        }
    }

    @ActivityCallback
    private void installPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        File directory = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        File apk = directory == null ? null : new File(directory, "codex-remote-update.apk");
        if (Build.VERSION.SDK_INT >= 26 && getContext().getPackageManager().canRequestPackageInstalls() && apk != null && apk.exists()) launchInstaller(apk, call);
        else call.reject("未授予安装应用权限");
    }
}
