
<template>
  <el-form :model="formData" ref="vForm" :rules="rules" label-position="left" label-width="150px" style="padding: 100px"
           size="default" @submit.prevent>
    <div class="static-content-item">
      <div>Nas迅雷设置中心</div>
    </div>
    <div class="static-content-item">
      <el-divider direction="horizontal"></el-divider>
    </div>
    <el-form-item label="Nas首页地址" prop="input23031" class="required label-right-align">
      <el-input v-model="formData.input23031" type="text" clearable id="nas-url"></el-input>
    </el-form-item>
    <el-form-item label="迅雷共享文件夹" prop="input12931" class="label-right-align">
      <el-input v-model="formData.input12931" type="text" id="nas-shared-path" ></el-input>
    </el-form-item>
    <el-form-item label="点击链接后自动弹窗" prop="switch96070" class="label-right-align">
      <el-switch v-model="formData.switch96070" id="reg-protocol"></el-switch>
    </el-form-item>
    <div class="static-content-item">
      <el-button type="primary" round class="float-right" id="confirm-config">保存配置</el-button>
    </div>
  </el-form>

</template>

<script>
import {defineComponent, getCurrentInstance, reactive, toRefs} from 'vue'

export default defineComponent({
  components: {},
  props: {},
  setup() {
    const state = reactive({
      formData: {
        input23031: "",
        input12931: "",
        switch96070: true,
      },
      rules: {
        input23031: [{
          required: true,
          message: '字段值不可为空',
        }],
      },
    })
    const instance = getCurrentInstance()
    const submitForm = () => {
      instance.ctx.$refs['vForm'].validate(valid => {
        if (!valid) return
        //TODO: 提交表单
      })
    }
    const resetForm = () => {
      instance.ctx.$refs['vForm'].resetFields()
    }
    return {
      ...toRefs(state),
      submitForm,
      resetForm
    }
  }
})

</script>

<style lang="scss">
.el-input-number.full-width-input,
.el-cascader.full-width-input {
  width: 100% !important;
}

.el-form-item--medium {
  .el-radio {
    line-height: 36px !important;
  }

  .el-rate {
    margin-top: 8px;
  }
}

.el-form-item--small {
  .el-radio {
    line-height: 32px !important;
  }

  .el-rate {
    margin-top: 6px;
  }
}

.el-form-item--mini {
  .el-radio {
    line-height: 28px !important;
  }

  .el-rate {
    margin-top: 4px;
  }
}

.clear-fix:before,
.clear-fix:after {
  display: table;
  content: "";
}

.clear-fix:after {
  clear: both;
}

.float-right {
  float: right;
}

</style>

<style lang="scss" scoped>
div.table-container {
  table.table-layout {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;

    td.table-cell {
      display: table-cell;
      height: 36px;
      border: 1px solid #e1e2e3;
    }
  }
}

div.tab-container {}

.label-left-align :deep(.el-form-item__label) {
  text-align: left;
}

.label-center-align :deep(.el-form-item__label) {
  text-align: center;
}

.label-right-align :deep(.el-form-item__label) {
  text-align: right;
}

.custom-label {}

.static-content-item {
  min-height: 20px;
  display: flex;
  align-items: center;

  :deep(.el-divider--horizontal) {
    margin: 0;
  }
}

</style>