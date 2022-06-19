<template>
  <h1> {{ msg }} </h1>
</template>

<script>
import { reactive, toRefs } from 'vue';
import _ from 'lodash';
export default {
    setup() {
        const state = reactive({
            msg: _.join(['simple', 'vite'], ' '),
        });
        return {
            ...toRefs(state),
        };
    }
};
</script>
