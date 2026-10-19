const FAB_URL = "https://fab.gdibao.com/";

Page({
  data: {
    failed: false,
    fabUrl: FAB_URL,
  },

  handleLoad() {
    this.setData({ failed: false });
  },

  handleError() {
    this.setData({ failed: true });
  },

  retry() {
    this.setData({ failed: false, fabUrl: `${FAB_URL}?miniapp_retry=${Date.now()}` });
  },

  copyAddress() {
    wx.setClipboardData({ data: FAB_URL });
  },

  onShareAppMessage() {
    return {
      path: "/pages/index/index",
      title: "驰拓 AI 助手",
    };
  },
});
