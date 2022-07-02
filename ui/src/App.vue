<template>
  <el-config-provider namespace="ep">
    <BaseHeader />
    <div style="display: flex">
      <div>
        <img alt="Vue logo" class="element-plus-logo" src="./assets/logo.png" />
        <ConfigCenter msg="Nas迅雷设置中心" />
      </div>
    </div>
  </el-config-provider>
</template>

<style>
#app {
  text-align: center;
  color: var(--ep-text-color-primary);
}

.element-plus-logo {
  width: 50%;
}
</style>
