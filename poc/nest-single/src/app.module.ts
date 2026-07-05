import { Module } from "@nestjs/common";
import { CustomPermissionGuardModule } from "./custom-permission-guard/custom-permission-guard.module.js";

@Module({
  imports: [CustomPermissionGuardModule],
})
export class AppModule {}
