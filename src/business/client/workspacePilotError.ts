type TrpcErrorLike = { data?: { code?: string }; message?: string };

export const getWorkspacePilotError = (error: unknown): string => {
  const code = (error as TrpcErrorLike | null)?.data?.code;
  switch (code) {
    case 'BAD_REQUEST': {
      return '输入无效或未选择正确的工作区，请检查后重试。';
    }
    case 'CONFLICT': {
      return '工作区标识已占用，或该用户已是成员。';
    }
    case 'FORBIDDEN': {
      return '当前账号没有执行此操作的权限。';
    }
    case 'NOT_FOUND': {
      return '目标不存在、未绑定 Casdoor，或当前账号无权访问。';
    }
    case 'UNAUTHORIZED': {
      return '登录已失效，请重新登录后继续。';
    }
    default: {
      return '操作未完成，请稍后重试；如持续失败请联系管理员。';
    }
  }
};
