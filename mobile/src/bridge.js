/**
 * Capacitor 外掛橋接
 *
 * 前端是不經打包的原生 JS（<script src> 直接載入），沒有 import 機制，
 * 而 Capacitor 注入到 WebView 的 native bridge 只負責傳訊，不會自動把外掛掛到全域。
 * 所以這裡用 esbuild 把要用到的外掛打包成一支 IIFE，掛在 window.SMCap 上，
 * 給 static/js/native.js 使用。
 *
 * 產出：mobile/www/vendor/capacitor-bridge.js（由 scripts/build_mobile.py 建置）
 */
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Preferences } from '@capacitor/preferences';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';

window.SMCap = {
  Capacitor,
  Filesystem,
  Directory,
  Share,
  Preferences,
  StatusBar,
  Style,
  SplashScreen,
};
