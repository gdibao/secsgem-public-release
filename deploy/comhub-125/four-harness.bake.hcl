variable "APP_TAG" {
  default = "local/fab-v218-market:c12-four-harness"
}

variable "HARNESS_TAG" {
  default = "local/fab-harness:c12-four-harness"
}

variable "COMMIT_SHA" {
  default = "unknown"
}

variable "BUILD_AT" {
  default = "unknown"
}

group "default" {
  targets = ["app", "harness"]
}

target "common" {
  context    = "."
  dockerfile = "Dockerfile"
  args = {
    USE_CN_MIRROR     = "true"
    COMMIT_SHA        = "${COMMIT_SHA}"
    COMHUB_COMMIT_SHA = "${COMMIT_SHA}"
    COMHUB_BUILD_AT   = "${BUILD_AT}"
  }
  output = ["type=docker"]
}

target "app" {
  inherits = ["common"]
  target   = "production"
  tags     = ["${APP_TAG}"]
  args = {
    COMHUB_IMAGE_TAG = "${APP_TAG}"
  }
}

target "harness" {
  inherits = ["common"]
  target   = "harness"
  tags     = ["${HARNESS_TAG}"]
  args = {
    COMHUB_IMAGE_TAG = "${HARNESS_TAG}"
  }
}
