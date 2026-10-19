# CAD/BOM runner 容器（D-1 已批准并入 R2 构建）
# ezdxf==1.4.5 锁版本（P12/P13/P14 三处一致）；python:3.11-slim 基座。
FROM docker.m.daocloud.io/library/python:3.11-slim
WORKDIR /runner
# CN 镜像默认；D-2 代理例外仅在构建命令级 env，不写入本文件
RUN pip install --no-cache-dir ezdxf==1.4.5
COPY dxf_worker.py /runner/dxf_worker.py
COPY httpd_worker.py /runner/httpd_worker.py
# 非 root 运行
RUN useradd -r runner && chown -R runner /runner
USER runner
# 协议：stdin 一行 JSON → stdout 一行 JSON（由 Node 主服务 spawn/经 compose 服务调用）
ENTRYPOINT ["python3", "/runner/dxf_worker.py"]

