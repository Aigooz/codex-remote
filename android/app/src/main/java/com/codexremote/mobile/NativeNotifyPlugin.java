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
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

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
        Uri sourceUri = Uri.parse(source);
        if (!"https".equalsIgnoreCase(sourceUri.getScheme()) || !"github.com".equalsIgnoreCase(sourceUri.getHost()) || sourceUri.getPath() == null || !sourceUri.getPath().contains("/releases/download/")) {
            call.reject("更新地址必须是 GitHub Release APK");
            return;
        }
        updateExecutor.execute(() -> downloadUpdate(source, call));
    }

    private void downloadUpdate(String source, PluginCall call) {
        HttpURLConnection connection = null;
        File apk = null;
        try {
            File directory = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (directory == null) throw new IllegalStateException("无法访问应用下载目录");
            if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("无法创建下载目录");
            apk = new File(directory, "codex-remote-update.apk");
            connection = (HttpURLConnection) new URL(source).openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", "application/octet-stream");
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("下载失败，HTTP " + status);
            if (connection.getContentLengthLong() > 150L * 1024 * 1024) throw new IllegalStateException("APK 文件超过 150 MB 限制");
            try (java.io.InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(apk)) {
                byte[] buffer = new byte[16384];
                long total = 0;
                int count;
                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    if (total > 150L * 1024 * 1024) throw new IllegalStateException("APK 文件超过 150 MB 限制");
                    output.write(buffer, 0, count);
                }
            }
            if (apk.length() < 1024) throw new IllegalStateException("下载的安装包无效");
            validateUpdatePackage(apk);
            File downloaded = apk;
            getActivity().runOnUiThread(() -> launchInstaller(downloaded, call));
        } catch (Exception error) {
            if (apk != null) apk.delete();
            call.reject("更新下载失败：" + error.getMessage(), error);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void validateUpdatePackage(File apk) throws Exception {
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
        if (Build.VERSION.SDK_INT >= 28 && candidate.getLongVersionCode() <= installed.getLongVersionCode()) {
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
