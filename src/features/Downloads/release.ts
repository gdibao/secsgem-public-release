export const CHITUO_DOWNLOADS_URL = 'https://secsgem.com.cn/downloads/';
export const CHITUO_CLI_TGZ_URL = `${CHITUO_DOWNLOADS_URL}v2.2.17-chituo.32/ct-claw-fab-cli-2.2.17-chituo.32.tgz`;

export const CLI_INSTALL_COMMAND = `npm install -g ${CHITUO_CLI_TGZ_URL}`;
export const CLI_HELP_COMMAND = 'chituo --help';

// Captured from the release CLI after its isolated verification.
export const CLI_HELP_OUTPUT = `Usage: chituo [options] [command]

Chituo AI CLI - connect to Fab and manage supported resources

Options:
  -V, --version          output the version number
  -h, --help             display help for command

Commands:
  tool-worker [options]  Internal command for isolated tool execution
  login [options]        Log in to Chituo AI via browser or configure an API key
                         server
  logout                 Log out and remove stored credentials
  completion [shell]     Output shell completion script
  man [command...]       Show a manual page for the CLI or a subcommand
  connect [options]      Connect to the device gateway and listen for tool calls
  disconnect             Disconnect from the device gateway
  device                 Manage connected devices
  status [options]       Check if gateway connection can be established
  doc                    Manage documents
  search [options]       Search across local resources or the web
  kb                     Manage knowledge bases, folders, documents, and files
  memory                 Manage user memories
  agent                  Manage agents
  agent-group            Manage agent groups
  bot                    Manage bot integrations
  generate|gen           Generate content (text, image, video, speech)
  file                   Manage files
  skill                  Manage agent skills
  session-group          Manage agent session groups
  task                   Manage agent tasks
  thread                 Manage message threads
  topic                  Manage conversation topics
  message                Manage messages
  model                  Manage AI models
  module-app             Develop Module Apps
  provider               Manage AI providers
  plugin                 Manage plugins
  user                   Manage user account and settings
  whoami [options]       Display current user information
  usage [options]        View usage statistics
  help [command]         display help for command`;
