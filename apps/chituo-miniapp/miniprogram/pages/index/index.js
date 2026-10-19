Page({
  data: {
    networkLabel: "正在检查网络",
    online: true,
  },

  onShow() {
    wx.getNetworkType({
      fail: () => this.setData({ networkLabel: "网络状态未知", online: false }),
      success: ({ networkType }) => {
        const online = networkType !== "none";
        this.setData({
          networkLabel: online ? `当前网络：${networkType}` : "当前无可用网络",
          online,
        });
      },
    });
  },

  openFab() {
    if (!this.data.online) {
      wx.showToast({ icon: "none", title: "请先连接网络" });
      return;
    }
    wx.navigateTo({ url: "/pages/fab/fab" });
  },

  onShareAppMessage() {
    return {
      path: "/pages/index/index",
      title: "驰拓 AI 助手",
    };
  },
});
