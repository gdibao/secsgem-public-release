import { TraeAcpAdapter } from './traeAcp';

/** Maps the standard ACP stream emitted by DeepSeek Harness into Fab events. */
export class DshAcpAdapter extends TraeAcpAdapter {
  constructor() {
    super({ eventPrefix: 'dsh', provider: 'dsh' });
  }
}
